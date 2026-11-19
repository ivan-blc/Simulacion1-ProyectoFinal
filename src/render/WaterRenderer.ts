import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { BLOCK_SIZE, CHUNK_SIZE } from '../core/constants';
import { LIQUID } from '../world/liquidParams';
import type { WorldManager } from '../world/WorldManager';

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;
const SURFACE_STRIP_PX = 2; // grosor de la franja clara de la superficie

/** Textura de 2x2 píxeles de un solo color (las UV de la malla apuntan a su centro). */
function solidTexture(r: number, g: number, b: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, 2, 2);
  return Texture.from(canvas);
}

/**
 * Una sola malla con un rectángulo por cada celda visible. Los índices y las UV son fijos
 * (cada rectángulo i usa los vértices 4i..4i+3); solo se reescriben las posiciones.
 * Los rectángulos sin usar quedan con todos sus vértices en (0, 0): no se ven.
 */
class QuadBatch {
  readonly container = new Container();
  private readonly texture: Texture;
  private readonly alpha: number;
  private capacity = 0;
  private positions = new Float32Array(0);
  private geometry: MeshGeometry | null = null;
  private mesh: Mesh | null = null;
  private count = 0;
  private previous = 0;
  private grown = true; // hay que crear la malla (primer uso o la capacidad creció)

  constructor(texture: Texture, alpha: number) {
    this.texture = texture;
    this.alpha = alpha;
  }

  get quads(): number {
    return this.count;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, w: number, h: number): void {
    if (this.count >= this.capacity) this.grow();
    const o = this.count * 8;
    const p = this.positions;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = x + w;
    p[o + 3] = y;
    p[o + 4] = x + w;
    p[o + 5] = y + h;
    p[o + 6] = x;
    p[o + 7] = y + h;
    this.count++;
  }

  end(): void {
    if (this.capacity === 0) return; // todavía no hubo ningún rectángulo
    if (this.grown) {
      this.rebuild();
    } else if (this.geometry) {
      // Lo que sobra de la vez anterior se deja degenerado (todo en 0)
      this.positions.fill(0, this.count * 8, Math.min(this.previous, this.capacity) * 8);
      // Reasignar el MISMO array sube los datos a la GPU (igual que en ChunkRenderer)
      this.geometry.positions = this.positions;
    }
    if (this.mesh) this.mesh.visible = this.count > 0;
    this.previous = this.count;
  }

  private grow(): void {
    const next = Math.max(1024, this.capacity * 2);
    const positions = new Float32Array(next * 8);
    positions.set(this.positions);
    this.positions = positions;
    this.capacity = next;
    this.grown = true;
  }

  private rebuild(): void {
    if (this.mesh) {
      this.container.removeChild(this.mesh);
      this.mesh.destroy();
    }
    const cap = this.capacity;
    const indices = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      const v = i * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    const uvs = new Float32Array(cap * 8).fill(0.5);
    this.positions.fill(0, this.count * 8); // por si la capacidad creció a mitad de un update
    const geometry = new MeshGeometry({ positions: this.positions, uvs, indices });
    const mesh = new Mesh({ geometry, texture: this.texture });
    mesh.alpha = this.alpha;
    this.container.addChild(mesh);
    this.geometry = geometry;
    this.mesh = mesh;
    this.grown = false;
  }
}

/**
 * Dibuja el agua del área visible con dos mallas: el cuerpo (azul translúcido) y una franja
 * clara en la superficie. No toca las texturas de los chunks, así que el agua puede moverse
 * todo el tiempo sin reconstruirlas. Añade `container` al contenedor del mundo.
 */
export class WaterRenderer {
  readonly container = new Container();
  readonly stats = { quads: 0, ms: 0 };

  private readonly world: WorldManager;
  private readonly body: QuadBatch;
  private readonly surface: QuadBatch;

  constructor(world: WorldManager) {
    this.world = world;
    this.body = new QuadBatch(solidTexture(44, 108, 214), 0.55);
    this.surface = new QuadBatch(solidTexture(150, 205, 255), 0.7);
    this.container.addChild(this.body.container);
    this.container.addChild(this.surface.container);
  }

  /** Coordenadas del mundo en píxeles del área visible. Llamar una vez por fotograma. */
  update(left: number, top: number, right: number, bottom: number): void {
    const t0 = performance.now();
    const MAX = LIQUID.MAX_LEVEL;
    this.body.begin();
    this.surface.begin();

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
          const above = ly > 0 ? liquid[(ly - 1) * CHUNK_SIZE + lx] : this.world.getLiquid(bx, by - 1);
          const full = above > 0; // con agua encima, la celda se dibuja completa (sin huecos)
          const h = full ? BLOCK_SIZE : Math.max(1, Math.round((level / MAX) * BLOCK_SIZE));
          const x = bx * BLOCK_SIZE;
          const y = (by + 1) * BLOCK_SIZE - h;
          this.body.push(x, y, BLOCK_SIZE, h);
          if (!full) this.surface.push(x, y, BLOCK_SIZE, Math.min(SURFACE_STRIP_PX, h));
        }
      }
    });

    this.body.end();
    this.surface.end();
    this.stats.quads = this.body.quads;
    this.stats.ms = performance.now() - t0;
  }
}
