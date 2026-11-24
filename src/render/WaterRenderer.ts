import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { isSolidBlock } from '../core/blockInfo';
import { BLOCK_SIZE, CHUNK_SIZE } from '../core/constants';
import { chunkKey } from '../core/coords';
import type { Chunk } from '../world/Chunk';
import { LIQUID } from '../world/liquidParams';
import type { WorldManager } from '../world/WorldManager';
import { WaterGrid, buildWaterGeometry, isFallingCell, stripWidthPx, type WaterSink } from './waterSmoothing';

/**
 * true: el agua se dibuja como polígonos recortados con el terreno suavizado (mallas por chunk con
 * caché). false: el dibujo anterior, un rectángulo por celda. Se conserva para poder comparar.
 */
export const SMOOTH_WATER = true;
/** Reconstrucciones de chunks de agua por fotograma como máximo (como ChunkRenderer con el terreno). */
export const WATER_REBUILDS_PER_FRAME = 4;

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;
const SURFACE_STRIP_PX = 2; // grosor de la franja clara de la superficie en el dibujo antiguo
const BODY_COLOR: [number, number, number] = [44, 108, 214];
const BODY_ALPHA = 0.55;
const BAND_COLOR: [number, number, number] = [150, 205, 255];
const BAND_ALPHA = 0.7;

/** Textura de 2x2 píxeles de un solo color (las UV de la malla apuntan a su centro). */
function solidTexture(color: [number, number, number]): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.fillRect(0, 0, 2, 2);
  return Texture.from(canvas);
}

/**
 * Malla de triángulos de un solo color con buffers que crecen en potencias de dos. Las UV son fijas
 * (el centro de la textura de un color). Cuando la capacidad no cambia, las posiciones y los índices se
 * reescriben en sitio y se reasignan los MISMOS arrays para subirlos a la GPU (como en ChunkRenderer).
 */
class TriMesh {
  readonly container = new Container();
  vertexCount = 0;
  indexCount = 0;

  private readonly texture: Texture;
  private readonly alpha: number;
  private vertexCap = 0;
  private indexCap = 0;
  private positions = new Float32Array(0);
  private uvs = new Float32Array(0);
  private indices = new Uint32Array(0);
  private geometry: MeshGeometry | null = null;
  private mesh: Mesh | null = null;
  private previousIndexCount = 0;
  private grown = true;

  constructor(texture: Texture, alpha: number) {
    this.texture = texture;
    this.alpha = alpha;
  }

  begin(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  /** Polígono convexo en coordenadas unitarias (0..1) de una celda, escalado a píxeles y trasladado a (ox, oy). */
  polygonUnit(pts: ArrayLike<number>, n: number, ox: number, oy: number, scale: number): void {
    this.ensure(n, 3 * (n - 2));
    const base = this.vertexCount;
    const p = this.positions;
    for (let k = 0; k < n; k++) {
      p[2 * (base + k)] = ox + pts[2 * k] * scale;
      p[2 * (base + k) + 1] = oy + pts[2 * k + 1] * scale;
    }
    this.fan(base, n);
  }

  /** Rectángulo en píxeles del mundo. */
  quad(x: number, y: number, w: number, h: number): void {
    this.ensure(4, 6);
    const base = this.vertexCount;
    const p = this.positions;
    const o = 2 * base;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = x + w;
    p[o + 3] = y;
    p[o + 4] = x + w;
    p[o + 5] = y + h;
    p[o + 6] = x;
    p[o + 7] = y + h;
    this.fan(base, 4);
  }

  end(): void {
    if (this.vertexCap === 0) return; // todavía no se dibujó nada
    if (this.grown) {
      this.rebuild();
    } else if (this.geometry) {
      // Lo que sobra de la vez anterior queda con índices 0 (triángulos degenerados)
      this.indices.fill(0, this.indexCount, Math.min(this.previousIndexCount, this.indexCap));
      this.geometry.positions = this.positions;
      this.geometry.indices = this.indices;
    }
    if (this.mesh) this.mesh.visible = this.indexCount > 0;
    this.previousIndexCount = this.indexCount;
  }

  private fan(base: number, n: number): void {
    const idx = this.indices;
    let o = this.indexCount;
    for (let k = 1; k < n - 1; k++) {
      idx[o++] = base;
      idx[o++] = base + k;
      idx[o++] = base + k + 1;
    }
    this.indexCount = o;
    this.vertexCount = base + n;
  }

  private ensure(vertices: number, indices: number): void {
    if (this.vertexCount + vertices > this.vertexCap) {
      const next = Math.max(256, this.vertexCap * 2, this.vertexCount + vertices);
      const positions = new Float32Array(next * 2);
      positions.set(this.positions);
      this.positions = positions;
      this.uvs = new Float32Array(next * 2).fill(0.5);
      this.vertexCap = next;
      this.grown = true;
    }
    if (this.indexCount + indices > this.indexCap) {
      const next = Math.max(768, this.indexCap * 2, this.indexCount + indices);
      const grownIdx = new Uint32Array(next);
      grownIdx.set(this.indices);
      this.indices = grownIdx;
      this.indexCap = next;
      this.grown = true;
    }
  }

  private rebuild(): void {
    if (this.mesh) {
      this.container.removeChild(this.mesh);
      this.mesh.destroy();
    }
    this.indices.fill(0, this.indexCount);
    const geometry = new MeshGeometry({ positions: this.positions, uvs: this.uvs, indices: this.indices });
    const mesh = new Mesh({ geometry, texture: this.texture });
    mesh.alpha = this.alpha;
    this.container.addChild(mesh);
    this.geometry = geometry;
    this.mesh = mesh;
    this.grown = false;
  }
}

/** Agua de un chunk: cuerpo (azul translúcido) y banda clara de la superficie. */
interface Entry {
  chunk: Chunk;
  container: Container;
  body: TriMesh;
  band: TriMesh;
  seenLiquid: number;
  seenBlocks: number;
  dirty: boolean;
}

/**
 * Dibuja el agua del área visible sin tocar las texturas de los chunks, así que el agua puede moverse
 * todo el tiempo sin reconstruirlas. Añade `container` al contenedor del mundo y llama a `update`
 * una vez por fotograma.
 *
 * Modo suave (SMOOTH_WATER): una malla por chunk con agua, construida con la geometría de
 * waterSmoothing.ts y guardada en caché; solo se reconstruye si cambió el agua o un bloque del chunk o
 * de sus 8 vecinos. Las celdas en caída se dibujan como tiras verticales.
 */
export class WaterRenderer {
  readonly container = new Container();
  readonly stats = { rebuilds: 0, chunks: 0, vertices: 0, ms: 0 };

  private readonly world: WorldManager;
  private readonly smooth: boolean;
  private readonly bodyTexture = solidTexture(BODY_COLOR);
  private readonly bandTexture = solidTexture(BAND_COLOR);

  // modo suave
  private readonly entries = new Map<string, Entry>();
  private readonly grid = new WaterGrid();
  private readonly sink: WaterSink;
  private target: Entry | null = null;

  // modo antiguo
  private readonly legacyBody: TriMesh;
  private readonly legacySurface: TriMesh;

  constructor(world: WorldManager, options: { smooth?: boolean } = {}) {
    this.world = world;
    this.smooth = options.smooth ?? SMOOTH_WATER;
    this.legacyBody = new TriMesh(this.bodyTexture, BODY_ALPHA);
    this.legacySurface = new TriMesh(this.bandTexture, BAND_ALPHA);
    if (!this.smooth) {
      this.container.addChild(this.legacyBody.container);
      this.container.addChild(this.legacySurface.container);
    }
    this.sink = {
      polygon: (pts, n, lx, ly, band) => {
        const e = this.target!;
        (band ? e.band : e.body).polygonUnit(
          pts,
          n,
          (e.chunk.cx * CHUNK_SIZE + lx + 0.5) * BLOCK_SIZE,
          (e.chunk.cy * CHUNK_SIZE + ly + 0.5) * BLOCK_SIZE,
          BLOCK_SIZE,
        );
      },
      strip: (lx, ly, level) => {
        const e = this.target!;
        const w = stripWidthPx(level);
        e.body.quad((e.chunk.cx * CHUNK_SIZE + lx) * BLOCK_SIZE + (BLOCK_SIZE - w) / 2, (e.chunk.cy * CHUNK_SIZE + ly) * BLOCK_SIZE, w, BLOCK_SIZE);
      },
    };
  }

  /** Coordenadas del mundo en píxeles del área visible. Llamar una vez por fotograma. */
  update(left: number, top: number, right: number, bottom: number): void {
    const t0 = performance.now();
    this.stats.rebuilds = 0;
    if (this.smooth) this.updateSmooth(left, top, right, bottom);
    else this.updateLegacy(left, top, right, bottom);
    this.stats.ms = performance.now() - t0;
  }

  // ---------------------------------------------------------------------------------------------
  // Modo suave
  // ---------------------------------------------------------------------------------------------

  private updateSmooth(left: number, top: number, right: number, bottom: number): void {
    // 1) Altas y bajas de chunks
    const present = new Set<string>();
    this.world.forEachChunk((chunk) => {
      const key = chunkKey(chunk.cx, chunk.cy);
      present.add(key);
      const old = this.entries.get(key);
      if (old && old.chunk === chunk) return;
      if (old) this.removeEntry(key, old);
      this.addEntry(key, chunk);
    });
    for (const [key, entry] of this.entries) if (!present.has(key)) this.removeEntry(key, entry);

    // 2) Cambios de agua o de bloques: se rehace el chunk y sus vecinos (el margen de φ lee de ellos)
    for (const entry of this.entries.values()) {
      const c = entry.chunk;
      if (c.liquidVersion !== entry.seenLiquid || c.blockVersion !== entry.seenBlocks) {
        entry.seenLiquid = c.liquidVersion;
        entry.seenBlocks = c.blockVersion;
        this.markDirtyAround(c.cx, c.cy);
      }
    }

    // 3) Visibilidad y reconstrucción con presupuesto
    let budget = WATER_REBUILDS_PER_FRAME;
    let vertices = 0;
    let chunks = 0;
    for (const entry of this.entries.values()) {
      const px = entry.chunk.cx * CHUNK_PX;
      const py = entry.chunk.cy * CHUNK_PX;
      const inView = !(px + CHUNK_PX < left || px > right || py + CHUNK_PX < top || py > bottom);
      entry.container.visible = inView;
      if (!inView) continue;
      if (entry.dirty && budget > 0) {
        this.rebuild(entry);
        budget--;
        this.stats.rebuilds++;
      }
      if (entry.body.vertexCount + entry.band.vertexCount > 0) {
        vertices += entry.body.vertexCount + entry.band.vertexCount;
        chunks++;
      }
    }
    this.stats.vertices = vertices;
    this.stats.chunks = chunks;
  }

  private addEntry(key: string, chunk: Chunk): void {
    const container = new Container();
    const body = new TriMesh(this.bodyTexture, BODY_ALPHA);
    const band = new TriMesh(this.bandTexture, BAND_ALPHA);
    container.addChild(body.container);
    container.addChild(band.container);
    this.container.addChild(container);
    this.entries.set(key, { chunk, container, body, band, seenLiquid: chunk.liquidVersion, seenBlocks: chunk.blockVersion, dirty: true });
    this.markDirtyAround(chunk.cx, chunk.cy); // los vecinos ganan un vecino nuevo: su margen cambia
  }

  private removeEntry(key: string, entry: Entry): void {
    this.container.removeChild(entry.container);
    entry.container.destroy();
    this.entries.delete(key);
    this.markDirtyAround(entry.chunk.cx, entry.chunk.cy);
  }

  private markDirtyAround(cx: number, cy: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const e = this.entries.get(chunkKey(cx + dx, cy + dy));
        if (e) e.dirty = true;
      }
    }
  }

  private rebuild(entry: Entry): void {
    entry.dirty = false;
    entry.body.begin();
    entry.band.begin();
    const { chunk } = entry;
    this.grid.load(chunk.cx, chunk.cy, (cx, cy) => this.world.getChunk(cx, cy));
    if (this.grid.anyWater) {
      this.target = entry;
      buildWaterGeometry(this.grid, this.sink, true);
      this.target = null;
    }
    entry.body.end();
    entry.band.end();
  }

  // ---------------------------------------------------------------------------------------------
  // Modo antiguo: un rectángulo por celda (con tiras para el agua que cae)
  // ---------------------------------------------------------------------------------------------

  private updateLegacy(left: number, top: number, right: number, bottom: number): void {
    const MAX = LIQUID.MAX_LEVEL;
    this.legacyBody.begin();
    this.legacySurface.begin();

    this.world.forEachChunk((chunk) => {
      const px = chunk.cx * CHUNK_PX;
      const py = chunk.cy * CHUNK_PX;
      if (px + CHUNK_PX < left || px > right || py + CHUNK_PX < top || py > bottom) return;

      const liquid = chunk.liquid;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const level = liquid[ly * CHUNK_SIZE + lx];
          if (level === 0) continue;

          const bx = chunk.cx * CHUNK_SIZE + lx;
          const by = chunk.cy * CHUNK_SIZE + ly;
          const x = bx * BLOCK_SIZE;

          // Agua que cae: tira vertical de altura completa
          const belowBlocked = ly < CHUNK_SIZE - 1 ? isSolidBlock(chunk.blocks[(ly + 1) * CHUNK_SIZE + lx]) : this.world.isLiquidBlocked(bx, by + 1);
          const belowLevel = ly < CHUNK_SIZE - 1 ? liquid[(ly + 1) * CHUNK_SIZE + lx] : this.world.getLiquid(bx, by + 1);
          if (isFallingCell(level, belowBlocked, belowLevel < 0 ? MAX : belowLevel)) {
            const w = stripWidthPx(level);
            this.legacyBody.quad(x + (BLOCK_SIZE - w) / 2, by * BLOCK_SIZE, w, BLOCK_SIZE);
            continue;
          }

          const above = ly > 0 ? liquid[(ly - 1) * CHUNK_SIZE + lx] : this.world.getLiquid(bx, by - 1);
          const full = above > 0; // con agua encima, la celda se dibuja completa (sin huecos)
          const h = full ? BLOCK_SIZE : Math.max(1, Math.round((level / MAX) * BLOCK_SIZE));
          const y = (by + 1) * BLOCK_SIZE - h;
          this.legacyBody.quad(x, y, BLOCK_SIZE, h);
          if (!full) this.legacySurface.quad(x, y, BLOCK_SIZE, Math.min(SURFACE_STRIP_PX, h));
        }
      }
    });

    this.legacyBody.end();
    this.legacySurface.end();
    this.stats.vertices = this.legacyBody.vertexCount;
    this.stats.chunks = 0;
  }
}
