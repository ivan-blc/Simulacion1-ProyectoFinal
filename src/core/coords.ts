import { BLOCK_SIZE, CHUNK_SIZE } from './constants';

// Píxeles del mundo -> coordenada de bloque (floor para que los negativos funcionen)
export const worldToBlockCoord = (p: number): number => Math.floor(p / BLOCK_SIZE);

// Coordenada de bloque -> coordenada de chunk
export const blockToChunkCoord = (b: number): number => Math.floor(b / CHUNK_SIZE);

// Coordenada de bloque -> coordenada local dentro del chunk (0..CHUNK_SIZE-1)
// El doble módulo evita resultados negativos: -1 % 32 sería -1 en JS
export const blockToLocalCoord = (b: number): number =>
  ((b % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;

// Versiones de conveniencia que devuelven ambos ejes
export function worldToBlock(px: number, py: number) {
  return { bx: worldToBlockCoord(px), by: worldToBlockCoord(py) };
}

export function blockToChunk(bx: number, by: number) {
  return { cx: blockToChunkCoord(bx), cy: blockToChunkCoord(by) };
}

export function blockToLocal(bx: number, by: number) {
  return { lx: blockToLocalCoord(bx), ly: blockToLocalCoord(by) };
}