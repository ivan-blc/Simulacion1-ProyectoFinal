import { Container, RenderTexture, Sprite } from 'pixi.js';
import type { Application, Texture } from 'pixi.js';
import { BLOCK_SIZE, BlockId, CHUNK_SIZE } from '../core/constants';
import { chunkKey } from '../core/coords';
import { ObjectPool } from '../core/ObjectPool';
import type { Chunk } from '../world/Chunk';

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;
const MAX_IDLE_TEXTURES = 16;

interface ChunkView {
  chunk: Chunk;
  sprite: Sprite;
  rt: RenderTexture | null; // se pide al pool en el primer render del chunk
}

export interface ChunkRendererOptions {
  renderer: Application['renderer'];
  blockTextures: Texture[];
  sky: Texture;
  cave: Texture;
  /** Altura de la superficie por columna: decide si un hueco es cielo o cueva. */
  surfaceHeight: (bx: number) => number;
}

export class ChunkRenderer {
  /** Añade este contenedor al contenedor del mundo. */
  readonly container = new Container();
  /** Máximo de chunks reconstruidos por frame (evita tirones). */
  maxBuildsPerFrame = 4;
  visibleCount = 0;

  private readonly views = new Map<string, ChunkView>();
  private readonly scratch = new Container(); // nunca se añade al stage
  private readonly cells: Sprite[] = [];
  private readonly opts: ChunkRendererOptions;
  private readonly rtPool = new ObjectPool<RenderTexture>(
    () => RenderTexture.create({ width: CHUNK_PX, height: CHUNK_PX, scaleMode: 'nearest' }),
    (rt) => rt.destroy(true), // true = destruye también el recurso de GPU
    MAX_IDLE_TEXTURES,
  );

  constructor(opts: ChunkRendererOptions) {
    this.opts = opts;
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      const cell = new Sprite();
      cell.position.set((i % CHUNK_SIZE) * BLOCK_SIZE, Math.floor(i / CHUNK_SIZE) * BLOCK_SIZE);
      this.scratch.addChild(cell);
      this.cells.push(cell);
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
    const { blockTextures, sky, cave, surfaceHeight, renderer } = this.opts;
    const x0 = chunk.cx * CHUNK_SIZE;
    const y0 = chunk.cy * CHUNK_SIZE;

    const heights = new Array<number>(CHUNK_SIZE);
    for (let lx = 0; lx < CHUNK_SIZE; lx++) heights[lx] = surfaceHeight(x0 + lx);

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const by = y0 + ly;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = ly * CHUNK_SIZE + lx;
        const id = chunk.blocks[i];
        this.cells[i].texture =
          id === BlockId.AIR ? (by < heights[lx] ? sky : cave) : blockTextures[id];
      }
    }

    if (!view.rt) {
      view.rt = this.rtPool.acquire();
      view.sprite.texture = view.rt;
    }

    renderer.render({ container: this.scratch, target: view.rt, clear: true });
    chunk.isDirty = false;
  }
}