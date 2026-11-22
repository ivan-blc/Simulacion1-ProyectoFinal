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

export const PixelMat = { EMPTY: 0, SAND: 1, WATER: 2, LAVA: 3, OIL: 4, SMOKE: 5 } as const;
export type PixelMat = (typeof PixelMat)[keyof typeof PixelMat];

export const PIXEL_INFO: Record<number, { name: string; color: number }> = {
  [PixelMat.SAND]: { name: 'arena', color: 0xdeb26c },
  [PixelMat.WATER]: { name: 'agua', color: 0x3a7ac4 },
  [PixelMat.LAVA]: { name: 'lava', color: 0xff6a1a },
  [PixelMat.OIL]: { name: 'aceite', color: 0xc4a030 },
  [PixelMat.SMOKE]: { name: 'humo', color: 0x8c8884 },
};

/** Mide cuánta agua o lava hay dentro de un rectángulo (en píxeles del mundo). */
export interface FluidSensor {
  /** Fracción (0..1) de las celdas del rectángulo que contienen este material. */
  fraction(x: number, y: number, w: number, h: number, mat: number): number;
}

/** Bits de `meta` por celda: 0-4 = agitación del agua (pasos de flujo horizontal restantes), 5-6 = tono de color. */
export const HEAT_MASK = 0x1f;
export const TONE_SHIFT = 5;
/** Variantes de tono por partícula (las mismas 4 del archivo de referencia). */
export const TONES = 4;

/** Detecta arena dentro de un rectángulo (px del mundo). Los cuerpos con colisión de arena la usan como sólida. */
export interface SandSensor {
  overlapsSand(x: number, y: number, w: number, h: number): boolean;
}