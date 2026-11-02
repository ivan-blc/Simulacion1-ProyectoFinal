export type WorkerRequest =
  | { type: 'init'; seed: number }
  | { type: 'gen'; cx: number; cy: number };

export interface WorkerResponse {
  type: 'chunk';
  cx: number;
  cy: number;
  /** Datos del chunk, transferidos (no copiados) desde el worker. */
  buffer: ArrayBuffer;
  /** Tiempo que tardó la generación dentro del worker. */
  ms: number;
}