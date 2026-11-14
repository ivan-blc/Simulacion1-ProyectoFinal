import { BlockId } from '../core/constants';

/** Valores por defecto de la generación. */
export const GEN = {
  // Superficie
  SURFACE_BASE: 64, // altura media (en bloques; Y crece hacia abajo)
  SURFACE_AMPLITUDE: 18, // la superficie varía en base ± amplitud
  SURFACE_FREQ: 0.008, // menor = colinas más anchas
  SURFACE_OCTAVES: 3,

  // Capas
  DIRT_MIN: 4, // grosor mínimo de tierra bajo el pasto
  DIRT_VARIATION: 4, // + 0..4 bloques extra por columna

  // Cuevas
  CAVE_ITERATIONS: 4,
  CAVE_PAD: 4, // DEBE ser >= CAVE_ITERATIONS (evita costuras)
  CAVE_SOLID_CHANCE: 0.48, // densidad inicial de sólidos (sube = menos cuevas)
  CAVE_MIN_DEPTH: 12, // por encima de esta profundidad nunca hay cuevas
  CAVE_RAMP: 16, // bloques para pasar de "sin cuevas" a densidad plena
} as const;

/** Minerales por defecto: aparecen donde el ruido supera el umbral y a partir de minDepth bloques bajo la superficie. */
export const ORES = [
  { id: BlockId.GOLD, minDepth: 70, freq: 0.2, threshold: 0.65, offset: 3000 },
  { id: BlockId.IRON, minDepth: 35, freq: 0.17, threshold: 0.6, offset: 2000 },
  { id: BlockId.COAL, minDepth: 12, freq: 0.15, threshold: 0.55, offset: 1000 },
] as const;

export interface OreParams {
  id: BlockId;
  /** Bloques bajo la superficie a partir de los cuales puede aparecer. */
  minDepth: number;
  /** Frecuencia del ruido: mayor = filones más pequeños y numerosos. */
  freq: number;
  /** El ruido (-1..1) debe superarlo: mayor = más escaso. */
  threshold: number;
  /** Desplazamiento en el ruido (distingue unos minerales de otros). */
  offset: number;
}

export interface GenParams {
  surfaceBase: number;
  surfaceAmplitude: number;
  surfaceFreq: number;
  surfaceOctaves: number;
  dirtMin: number;
  dirtVariation: number;
  caveIterations: number;
  /** Margen anti-costuras. El efectivo es máx(cavePad, caveIterations). */
  cavePad: number;
  caveSolidChance: number;
  caveMinDepth: number;
  caveRamp: number;
  /** De más raro a más común: el primero que cumple las condiciones gana. */
  ores: OreParams[];
}

export const DEFAULT_GEN_PARAMS: GenParams = {
  surfaceBase: GEN.SURFACE_BASE,
  surfaceAmplitude: GEN.SURFACE_AMPLITUDE,
  surfaceFreq: GEN.SURFACE_FREQ,
  surfaceOctaves: GEN.SURFACE_OCTAVES,
  dirtMin: GEN.DIRT_MIN,
  dirtVariation: GEN.DIRT_VARIATION,
  caveIterations: GEN.CAVE_ITERATIONS,
  cavePad: GEN.CAVE_PAD,
  caveSolidChance: GEN.CAVE_SOLID_CHANCE,
  caveMinDepth: GEN.CAVE_MIN_DEPTH,
  caveRamp: GEN.CAVE_RAMP,
  ores: ORES.map(
    (o): OreParams => ({
      id: o.id,
      minDepth: o.minDepth,
      freq: o.freq,
      threshold: o.threshold,
      offset: o.offset,
    }),
  ),
};

export function cloneGenParams(p: GenParams): GenParams {
  return { ...p, ores: p.ores.map((o) => ({ ...o })) };
}