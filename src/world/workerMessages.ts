import type { GenParams } from './genParams';

export type WorkerRequest =
  | { type: 'init'; seed: number; params: GenParams; epoch: number }
  | { type: 'config'; params: GenParams; epoch: number }
  | { type: 'gen'; cx: number; cy: number };

export interface WorkerResponse {
  type: 'chunk';
  cx: number;
  cy: number;
  /** Datos del chunk, transferidos (no copiados) desde el worker. */
  buffer: ArrayBuffer;
  /** Tiempo que tardó la generación dentro del worker. */
  ms: number;
  /** Época de configuración con la que se generó. Si no es la vigente, el resultado se descarta. */
  epoch: number;
}