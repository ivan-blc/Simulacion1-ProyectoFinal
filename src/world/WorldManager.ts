import { BlockId, CHUNK_SIZE } from '../core/constants';
import {
  blockToChunkCoord,
  blockToLocalCoord,
  chunkKey,
} from '../core/coords';
import { Chunk } from './Chunk';
import type { EditList } from './ChunkStore';

export type ChunkGenerator = (chunk: Chunk) => void;

export class WorldManager {
  private readonly chunks = new Map<string, Chunk>();
  private readonly generator: ChunkGenerator;

  /** Ediciones del jugador por chunk: índice local -> id. Persisten aunque el chunk se descargue. */
  private readonly edits = new Map<string, Map<number, number>>();
  /** Chunks con ediciones pendientes de guardar. */
  private readonly modifiedKeys = new Set<string>();

  /** Hooks de render (Fase 3). */
  onChunkLoaded?: (chunk: Chunk) => void;
  onChunkUnloaded?: (chunk: Chunk) => void;

  constructor(generator: ChunkGenerator = flatGenerator) {
    this.generator = generator;
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  /** Cargar ediciones guardadas. Llamar ANTES de crear el primer chunk. */
  loadEdits(saved: Map<string, EditList>): void {
    for (const [key, list] of saved) this.edits.set(key, new Map(list));
  }

  /** Devuelve las ediciones pendientes de guardar y vacía la cola. */
  takeModified(): Array<[string, EditList]> {
    const out: Array<[string, EditList]> = [];
    for (const key of this.modifiedKeys) {
      const m = this.edits.get(key);
      if (m) out.push([key, Array.from(m)]);
    }
    this.modifiedKeys.clear();
    return out;
  }

  /** Para reintentar un guardado fallido. */
  markModified(key: string): void {
    this.modifiedKeys.add(key);
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  /** Devuelve el chunk, generándolo (y aplicando sus ediciones) si no existe. */
  getOrCreateChunk(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cy);
      this.generator(chunk);

      const saved = this.edits.get(key);
      if (saved) for (const [i, id] of saved) chunk.blocks[i] = id;

      chunk.isDirty = true;
      this.chunks.set(key, chunk);
      this.onChunkLoaded?.(chunk);
    }
    return chunk;
  }

  /** Lectura: si el chunk no está cargado devuelve AIR (no lo genera). */
  getBlock(bx: number, by: number): BlockId {
    const chunk = this.getChunk(blockToChunkCoord(bx), blockToChunkCoord(by));
    if (!chunk) return BlockId.AIR;
    return chunk.get(blockToLocalCoord(bx), blockToLocalCoord(by));
  }

  /** Escritura: genera el chunk si hace falta y registra la edición. Devuelve true si hubo cambio. */
  setBlock(bx: number, by: number, id: BlockId): boolean {
    const cx = blockToChunkCoord(bx);
    const cy = blockToChunkCoord(by);
    const chunk = this.getOrCreateChunk(cx, cy);
    const lx = blockToLocalCoord(bx);
    const ly = blockToLocalCoord(by);

    if (!chunk.set(lx, ly, id)) return false; // marca isDirty

    const key = chunkKey(cx, cy);
    let m = this.edits.get(key);
    if (!m) {
      m = new Map();
      this.edits.set(key, m);
    }
    m.set(ly * CHUNK_SIZE + lx, id);
    this.modifiedKeys.add(key);
    return true;
  }

  /**
   * Carga los chunks alrededor del jugador y descarga los lejanos.
   * playerBx/playerBy son coordenadas de BLOQUE.
   */
  update(playerBx: number, playerBy: number, radius = 3): void {
    const pcx = blockToChunkCoord(playerBx);
    const pcy = blockToChunkCoord(playerBy);

    for (let cy = pcy - radius; cy <= pcy + radius; cy++) {
      for (let cx = pcx - radius; cx <= pcx + radius; cx++) {
        this.getOrCreateChunk(cx, cy);
      }
    }

    const unloadDist = radius + 1;
    for (const [key, chunk] of this.chunks) {
      if (
        Math.abs(chunk.cx - pcx) > unloadDist ||
        Math.abs(chunk.cy - pcy) > unloadDist
      ) {
        this.chunks.delete(key);
        this.onChunkUnloaded?.(chunk);
      }
    }
  }
}

/** Generador provisional por defecto: suelo plano en by = 64. */
function flatGenerator(chunk: Chunk): void {
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const by = chunk.cy * CHUNK_SIZE + ly;
    if (by < 64) continue;
    const id = by === 64 ? BlockId.GRASS : by < 70 ? BlockId.DIRT : BlockId.STONE;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) chunk.set(lx, ly, id);
  }
}