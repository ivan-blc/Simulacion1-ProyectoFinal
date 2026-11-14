import { BLOCK_SIZE, CHUNK_SIZE } from '../core/constants';

/** Celdas de píxel por bloque y por eje. Debe ser par: la malla de colisión se desplaza medio bloque. */
export const PPB = 8;
/** Lado de una celda, en píxeles del mundo. */
export const CELL_PX = BLOCK_SIZE / PPB;
/** Celdas por lado de un chunk. Debe ser 2^CHUNK_SHIFT: se usan desplazamientos de bits. */
export const CHUNK_PIX = CHUNK_SIZE * PPB;
export const CHUNK_SHIFT = 8;
export const CHUNK_MASK = CHUNK_PIX - 1;
export const HALF = PPB / 2;

if (1 << CHUNK_SHIFT !== CHUNK_PIX) {
  throw new Error('CHUNK_SHIFT no coincide con CHUNK_PIX: si cambias PPB, ajusta también CHUNK_SHIFT');
}

export const PixelMat = { EMPTY: 0, SAND: 1, WATER: 2, LAVA: 3 } as const;
export type PixelMat = (typeof PixelMat)[keyof typeof PixelMat];

export const PIXEL_INFO: Record<number, { name: string; color: number }> = {
  [PixelMat.SAND]: { name: 'arena', color: 0xdcc47a },
  [PixelMat.WATER]: { name: 'agua', color: 0x2e78dc },
  [PixelMat.LAVA]: { name: 'lava', color: 0xff6a1a },
};

/** Mide cuánta agua o lava hay dentro de un rectángulo (en píxeles del mundo). */
export interface FluidSensor {
  /** Fracción (0..1) de las celdas del rectángulo que contienen este material. */
  fraction(x: number, y: number, w: number, h: number, mat: number): number;
}