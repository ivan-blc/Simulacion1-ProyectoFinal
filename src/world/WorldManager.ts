import { BlockId, CHUNK_SIZE } from '../core/constants';
import {
  blockToChunkCoord,
  blockToLocalCoord,
  chunkKey,
} from '../core/coords';
import { Chunk } from './Chunk';
import type { EditList } from './ChunkStore';

export type ChunkGenerator = (chunk: Chunk) => void;

/** Generación asíncrona de chunks (Web Workers). */
export interface ChunkProvider {
  request(cx: number, cy: number): void;
  cancel(cx: number, cy: number): void;
}

export class WorldManager {
  private readonly chunks = new Map<string, Chunk>();
  private readonly generator: ChunkGenerator;

  /** Ediciones del jugador por chunk: índice local -> id. Persisten aunque el chunk se descargue. */
  private readonly edits = new Map<string, Map<number, number>>();
  /** Chunks con ediciones pendientes de guardar. */
  private readonly modifiedKeys = new Set<string>();

  /** Generación asíncrona: null = todo se genera de forma síncrona. */
  private provider: ChunkProvider | null = null;
  /** Chunks solicitados al provider que aún no han llegado. */
  private readonly pending = new Map<string, { cx: number; cy: number }>();

  /** Hooks de render. */
  onChunkLoaded?: (chunk: Chunk) => void;
  onChunkUnloaded?: (chunk: Chunk) => void;

  constructor(generator: ChunkGenerator = flatGenerator) {
    this.generator = generator;
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Activa (o desactiva con null) la generación asíncrona. Descarta las solicitudes pendientes. */
  setProvider(provider: ChunkProvider | null): void {
    this.provider = provider;
    this.pending.clear();
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

  /** Cuántos chunks del cuadrado (2r+1)² centrado en (cx, cy) están cargados. */
  loadedInArea(cx: number, cy: number, r: number): number {
    let n = 0;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (this.chunks.has(chunkKey(x, y))) n++;
      }
    }
    return n;
  }

  /** Devuelve el chunk, generándolo de forma SÍNCRONA (y aplicando sus ediciones) si no existe. */
  getOrCreateChunk(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      // Si estaba solicitado al worker, esa petición ya no hace falta
      if (this.pending.delete(key)) this.provider?.cancel(cx, cy);
      chunk = new Chunk(cx, cy);
      this.generator(chunk);
      this.register(chunk, key);
    }
    return chunk;
  }

  /**
   * Inserta un chunk generado por un worker. Devuelve false (y lo descarta)
   * si ya no se necesita: se canceló, se descargó o se generó de forma síncrona.
   */
  insertGenerated(cx: number, cy: number, blocks: Uint8Array): boolean {
    const key = chunkKey(cx, cy);
    if (!this.pending.delete(key)) return false;
    if (this.chunks.has(key) || blocks.length !== CHUNK_SIZE * CHUNK_SIZE) return false;
    const chunk = new Chunk(cx, cy);
    chunk.blocks.set(blocks);
    this.register(chunk, key);
    return true;
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
   * Con provider: solo SOLICITA los chunks que faltan (los más cercanos primero).
   * Sin provider: los genera en el momento.
   */
  update(playerBx: number, playerBy: number, radius = 3): void {
    const pcx = blockToChunkCoord(playerBx);
    const pcy = blockToChunkCoord(playerBy);
    const provider = this.provider;

    if (provider) {
      const wanted: Array<{ cx: number; cy: number; d: number }> = [];
      for (let cy = pcy - radius; cy <= pcy + radius; cy++) {
        for (let cx = pcx - radius; cx <= pcx + radius; cx++) {
          const key = chunkKey(cx, cy);
          if (this.chunks.has(key) || this.pending.has(key)) continue;
          wanted.push({ cx, cy, d: (cx - pcx) ** 2 + (cy - pcy) ** 2 });
        }
      }
      wanted.sort((a, b) => a.d - b.d);
      for (const w of wanted) {
        this.pending.set(chunkKey(w.cx, w.cy), { cx: w.cx, cy: w.cy });
        provider.request(w.cx, w.cy);
      }
    } else {
      for (let cy = pcy - radius; cy <= pcy + radius; cy++) {
        for (let cx = pcx - radius; cx <= pcx + radius; cx++) {
          this.getOrCreateChunk(cx, cy);
        }
      }
    }

    // Histéresis: se descarga a radius + 1 para no cargar y descargar en el borde
    const unloadDist = radius + 1;
    const far = (cx: number, cy: number) =>
      Math.abs(cx - pcx) > unloadDist || Math.abs(cy - pcy) > unloadDist;

    for (const [key, p] of this.pending) {
      if (far(p.cx, p.cy)) {
        this.pending.delete(key);
        provider?.cancel(p.cx, p.cy);
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (far(chunk.cx, chunk.cy)) {
        this.chunks.delete(key);
        this.onChunkUnloaded?.(chunk);
      }
    }
  }

  /** Aplica las ediciones guardadas, marca el chunk como sucio y avisa al render. */
  private register(chunk: Chunk, key: string): void {
    const saved = this.edits.get(key);
    if (saved) for (const [i, id] of saved) chunk.blocks[i] = id;
    chunk.isDirty = true;
    this.chunks.set(key, chunk);
    this.onChunkLoaded?.(chunk);
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