import { BlockId } from '../core/constants';
import {
  blockToChunkCoord,
  blockToLocalCoord,
  chunkKey,
} from '../core/coords';
import { Chunk } from './Chunk';

export type ChunkGenerator = (chunk: Chunk) => void;

export class WorldManager {
  private readonly chunks = new Map<string, Chunk>();
  private readonly generator: ChunkGenerator;

  /** Hooks para la Fase 3 (crear/destruir texturas de render). */
  onChunkLoaded?: (chunk: Chunk) => void;
  onChunkUnloaded?: (chunk: Chunk) => void;

  constructor(generator: ChunkGenerator = flatGenerator) {
    this.generator = generator;
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  /** Devuelve el chunk, generándolo si no existe. */
  getOrCreateChunk(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cy);
      this.generator(chunk);
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

  /** Escritura: genera el chunk si hace falta. Devuelve true si hubo cambio. */
  setBlock(bx: number, by: number, id: BlockId): boolean {
    const chunk = this.getOrCreateChunk(blockToChunkCoord(bx), blockToChunkCoord(by));
    return chunk.set(blockToLocalCoord(bx), blockToLocalCoord(by), id);
  }

  /**
   * Carga los chunks alrededor del jugador y descarga los lejanos.
   * playerBx/playerBy son coordenadas de BLOQUE.
   * Se descarga a radius + 1 (histéresis) para evitar carga/descarga
   * constante cuando el jugador está justo en el borde de un chunk.
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
        this.chunks.delete(key); // borrar durante la iteración de un Map es seguro
        this.onChunkUnloaded?.(chunk);
      }
    }
  }
}

/** Generador provisional (se reemplaza en la Fase 2): suelo plano en by = 64. */
function flatGenerator(chunk: Chunk): void {
  const size = 32; // CHUNK_SIZE
  for (let ly = 0; ly < size; ly++) {
    const by = chunk.cy * size + ly;
    if (by < 64) continue;
    const id = by === 64 ? BlockId.GRASS : by < 70 ? BlockId.DIRT : BlockId.STONE;
    for (let lx = 0; lx < size; lx++) chunk.set(lx, ly, id);
  }
}