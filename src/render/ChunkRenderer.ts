import { Container, Mesh, MeshGeometry, RenderTexture, Sprite } from 'pixi.js';
import type { Application, Texture } from 'pixi.js';
import { BLOCK_SIZE, CHUNK_SIZE } from '../core/constants';
import { blockToChunkCoord, blockToLocalCoord, chunkKey } from '../core/coords';
import { ObjectPool } from '../core/ObjectPool';
import type { Chunk } from '../world/Chunk';
import {
  CELLS,
  LAYER_BLOCK,
  LAYER_COUNT,
  LayerBuffers,
  SAMPLE_N,
  buildSmoothLayers,
  cellSkyMask,
  ranksFromSamples,
} from './smoothing';

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;
const MAX_IDLE_TEXTURES = 16;

interface ChunkView {
  chunk: Chunk;
  sprite: Sprite;
  rt: RenderTexture | null; // se pide al pool en el primer render del chunk
}

export interface ChunkRendererOptions {
  renderer: Application['renderer'];
  /** Textura repetible por id de bloque (índice = BlockId). */
  tileTextures: Texture[];
  sky: Texture;
  cave: Texture;
  /** Altura de la superficie por columna: decide si un hueco es cielo o cueva. */
  surfaceHeight: (bx: number) => number;
  /** Lectura global de bloques (para el margen de 1 bloque con los chunks vecinos). */
  getBlock: (bx: number, by: number) => number;
}

export class ChunkRenderer {
  /** Añade este contenedor al contenedor del mundo. */
  readonly container = new Container();
  /** Máximo de chunks reconstruidos por frame (evita tirones). */
  maxBuildsPerFrame = 4;
  visibleCount = 0;

  private readonly views = new Map<string, ChunkView>();
  private readonly opts: ChunkRendererOptions;

  // Escena de trabajo: fondo por celdas + una malla por capa (nunca se añade al stage)
  private readonly scratch = new Container();
  private readonly bgCells: Sprite[] = [];
  private readonly layers: LayerBuffers[] = [];
  private readonly geometries: MeshGeometry[] = [];
  private readonly meshes: Mesh[] = [];

  // Buffers de trabajo reutilizados en cada reconstrucción
  private readonly samples = new Uint8Array(SAMPLE_N * SAMPLE_N);
  private readonly ranks = new Uint8Array(SAMPLE_N * SAMPLE_N);
  private readonly heights = new Array<number>(SAMPLE_N).fill(0);

  private readonly rtPool = new ObjectPool<RenderTexture>(
    () => RenderTexture.create({ width: CHUNK_PX, height: CHUNK_PX, scaleMode: 'nearest' }),
    (rt) => rt.destroy(true), // true = destruye también el recurso de GPU
    MAX_IDLE_TEXTURES,
  );

  constructor(opts: ChunkRendererOptions) {
    this.opts = opts;

    // Fondo: una celda por sprite, desplazada medio bloque respecto a la rejilla de bloques
    for (let k = 0; k < CELLS * CELLS; k++) {
      const sprite = new Sprite();
      sprite.position.set(((k % CELLS) - 0.5) * BLOCK_SIZE, (Math.floor(k / CELLS) - 0.5) * BLOCK_SIZE);
      this.scratch.addChild(sprite);
      this.bgCells.push(sprite);
    }

    // Una malla por capa, con buffers de tamaño fijo
    for (let k = 0; k < LAYER_COUNT; k++) {
      const buffers = new LayerBuffers(CELLS * CELLS);
      const geometry = new MeshGeometry({
        positions: buffers.positions,
        uvs: buffers.uvs,
        indices: buffers.indices,
      });
      const mesh = new Mesh({ geometry, texture: opts.tileTextures[LAYER_BLOCK[k]] });
      mesh.visible = false;
      this.scratch.addChild(mesh);
      this.layers.push(buffers);
      this.geometries.push(geometry);
      this.meshes.push(mesh);
    }
  }

  get loadedCount(): number {
    return this.views.size;
  }

  /** Chunks que ahora mismo tienen una textura asignada (≈ 1 MB de GPU cada una). */
  get activeTextures(): number {
    let n = 0;
    for (const v of this.views.values()) if (v.rt) n++;
    return n;
  }

  get poolStats(): { created: number; reused: number; destroyed: number; idle: number } {
    return {
      created: this.rtPool.created,
      reused: this.rtPool.reused,
      destroyed: this.rtPool.destroyed,
      idle: this.rtPool.idleCount,
    };
  }

  /** Enlazar con world.onChunkLoaded. */
  addChunk(chunk: Chunk): void {
    const sprite = new Sprite();
    sprite.position.set(chunk.cx * CHUNK_PX, chunk.cy * CHUNK_PX);
    sprite.visible = false;
    this.container.addChild(sprite);
    this.views.set(chunkKey(chunk.cx, chunk.cy), { chunk, sprite, rt: null });

    // Los bordes de los vecinos ya construidos veían aire donde ahora hay terreno
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const v = this.views.get(chunkKey(chunk.cx + dx, chunk.cy + dy));
        if (v) v.chunk.isDirty = true;
      }
    }
  }

  /** Enlazar con world.onChunkUnloaded. La textura vuelve al pool para reutilizarse. */
  removeChunk(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    const view = this.views.get(key);
    if (!view) return;
    this.container.removeChild(view.sprite);
    view.sprite.destroy(); // por defecto NO destruye la textura
    if (view.rt) this.rtPool.release(view.rt);
    this.views.delete(key);
  }

  /** Enlazar con world.onBlockChanged: un bloque del borde cambia la forma de los chunks vecinos. */
  onBlockChanged(bx: number, by: number): void {
    const lx = blockToLocalCoord(bx);
    const ly = blockToLocalCoord(by);
    const cx = blockToChunkCoord(bx);
    const cy = blockToChunkCoord(by);
    const dx0 = lx === 0 ? -1 : 0;
    const dx1 = lx === CHUNK_SIZE - 1 ? 1 : 0;
    const dy0 = ly === 0 ? -1 : 0;
    const dy1 = ly === CHUNK_SIZE - 1 ? 1 : 0;
    for (let dy = dy0; dy <= dy1; dy++) {
      for (let dx = dx0; dx <= dx1; dx++) {
        if (dx === 0 && dy === 0) continue; // el propio chunk ya se marca en Chunk.set
        const v = this.views.get(chunkKey(cx + dx, cy + dy));
        if (v) v.chunk.isDirty = true;
      }
    }
  }

  /** Culling + reconstrucción de chunks sucios. Llamar una vez por frame. */
  update(left: number, top: number, right: number, bottom: number): void {
    let budget = this.maxBuildsPerFrame;
    let visible = 0;

    for (const view of this.views.values()) {
      const x = view.chunk.cx * CHUNK_PX;
      const y = view.chunk.cy * CHUNK_PX;
      const inView = x < right && x + CHUNK_PX > left && y < bottom && y + CHUNK_PX > top;

      // Los chunks fuera de pantalla permanecen sucios hasta que se vean
      if (inView && view.chunk.isDirty && budget > 0) {
        this.build(view);
        budget--;
      }

      view.sprite.visible = inView && view.rt !== null;
      if (view.sprite.visible) visible++;
    }
    this.visibleCount = visible;
  }

  private build(view: ChunkView): void {
    const { chunk } = view;
    const { sky, cave, surfaceHeight, getBlock, renderer } = this.opts;
    const N = SAMPLE_N;
    const s = this.samples;
    const x0 = chunk.cx * CHUNK_SIZE;
    const y0 = chunk.cy * CHUNK_SIZE;

    // 1) Muestras: el interior se copia fila a fila; solo el anillo de margen consulta al mundo
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      s.set(chunk.blocks.subarray(ly * CHUNK_SIZE, (ly + 1) * CHUNK_SIZE), (ly + 1) * N + 1);
    }
    for (let i = 0; i < N; i++) {
      s[i] = getBlock(x0 - 1 + i, y0 - 1); // fila superior
      s[(N - 1) * N + i] = getBlock(x0 - 1 + i, y0 + CHUNK_SIZE); // fila inferior
    }
    for (let j = 1; j < N - 1; j++) {
      s[j * N] = getBlock(x0 - 1, y0 - 1 + j); // columna izquierda
      s[j * N + N - 1] = getBlock(x0 + CHUNK_SIZE, y0 - 1 + j); // columna derecha
    }

    // 2) Fondo por celdas (cielo o cueva)
    for (let i = 0; i < N; i++) this.heights[i] = surfaceHeight(x0 - 1 + i);
    const skyMask = cellSkyMask(s, this.heights, y0 - 1);
    for (let k = 0; k < this.bgCells.length; k++) {
      this.bgCells[k].texture = skyMask[k] === 1 ? sky : cave;
    }

    // 3) Geometría de las capas, en sitio
    ranksFromSamples(s, this.ranks);
    buildSmoothLayers(this.ranks, this.layers);
    for (let k = 0; k < LAYER_COUNT; k++) {
      const lb = this.layers[k];
      const mesh = this.meshes[k];
      mesh.visible = lb.indexCount > 0;
      if (!mesh.visible) continue;
      // Reasignar los MISMOS arrays sube los datos a la GPU (el tamaño no cambia nunca)
      const g = this.geometries[k];
      g.positions = lb.positions;
      g.uvs = lb.uvs;
      g.indices = lb.indices;
    }

    // 4) Dibujar en la textura del chunk (cada render hace clear: reutilizar es seguro)
    if (!view.rt) {
      view.rt = this.rtPool.acquire();
      view.sprite.texture = view.rt;
    }
    renderer.render({ container: this.scratch, target: view.rt, clear: true });
    chunk.isDirty = false;
  }
}