import { BlockId, CHUNK_SIZE } from '../core/constants';

export class Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly blocks: Uint8Array = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE); // todo AIR (0)
  isDirty = true; // un chunk nuevo necesita su primer render

  /** Nivel de agua por celda (0..LIQUID.MAX_LEVEL). Capa independiente de `blocks`. */
  readonly liquid: Uint16Array = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  /** Celdas con agua que la simulación debe revisar. No se guarda ni se envía desde los workers. */
  readonly awake: Uint8Array = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  /** Cuántas celdas de `awake` están activas. */
  awakeCount = 0;
  /** El agua de este chunk cambió y está pendiente de guardar. */
  liquidDirty = false;

  constructor(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
  }

  get(lx: number, ly: number): BlockId {
    return this.blocks[ly * CHUNK_SIZE + lx] as BlockId;
  }

  /** Devuelve true si el bloque realmente cambió. */
  set(lx: number, ly: number, id: BlockId): boolean {
    const i = ly * CHUNK_SIZE + lx;
    if (this.blocks[i] === id) return false;
    this.blocks[i] = id;
    this.isDirty = true;
    return true;
  }
}