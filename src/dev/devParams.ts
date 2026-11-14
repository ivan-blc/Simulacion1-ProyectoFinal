import { DEFAULT_ENEMY_PARAMS } from '../entities/enemyParams';
import type { EnemyParams } from '../entities/enemyParams';
import { DEFAULT_GEN_PARAMS, cloneGenParams } from '../world/genParams';
import type { GenParams } from '../world/genParams';

export interface ParamSpec<K extends string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
}

export type GenNumKey = Exclude<keyof GenParams, 'ores'>;
export type OreNumKey = 'minDepth' | 'freq' | 'threshold';
export type EnemyNumKey = Exclude<keyof EnemyParams, 'spawnEnabled'>;

export const SURFACE_SPECS: Array<ParamSpec<GenNumKey>> = [
  { key: 'surfaceBase', label: 'Altura base (Y)', min: 20, max: 140, step: 1, hint: 'Altura media de la superficie. Y crece hacia abajo.' },
  { key: 'surfaceAmplitude', label: 'Amplitud de colinas', min: 0, max: 60, step: 1, hint: 'La superficie varía en base ± amplitud.' },
  { key: 'surfaceFreq', label: 'Frecuencia de colinas', min: 0.001, max: 0.05, step: 0.001, hint: 'Menor = colinas más anchas.' },
  { key: 'surfaceOctaves', label: 'Octavas de ruido', min: 1, max: 5, step: 1, hint: 'Más octavas = más detalle fino.' },
  { key: 'dirtMin', label: 'Tierra: grosor mínimo', min: 1, max: 15, step: 1 },
  { key: 'dirtVariation', label: 'Tierra: variación', min: 0, max: 10, step: 1, hint: 'Bloques extra de tierra, al azar por columna.' },
];

export const CAVE_SPECS: Array<ParamSpec<GenNumKey>> = [
  { key: 'caveSolidChance', label: 'Densidad de roca', min: 0.3, max: 0.65, step: 0.005, hint: 'Más alta = menos cuevas. Entre 0,45 y 0,50 salen cuevas orgánicas.' },
  { key: 'caveIterations', label: 'Iteraciones del autómata', min: 0, max: 8, step: 1, hint: 'Más iteraciones = cuevas más lisas.' },
  { key: 'cavePad', label: 'Margen anti-costuras', min: 0, max: 10, step: 1, hint: 'El efectivo es máx(margen, iteraciones): nunca hay costuras.' },
  { key: 'caveMinDepth', label: 'Profundidad mínima', min: 0, max: 40, step: 1, hint: 'Bloques bajo la superficie sin cuevas.' },
  { key: 'caveRamp', label: 'Transición de densidad', min: 1, max: 60, step: 1, hint: 'Bloques hasta llegar a la densidad plena.' },
];

export const ORE_SPECS: Array<ParamSpec<OreNumKey>> = [
  { key: 'minDepth', label: 'Profundidad mínima', min: 0, max: 160, step: 1 },
  { key: 'freq', label: 'Frecuencia', min: 0.02, max: 0.6, step: 0.01, hint: 'Mayor = filones más pequeños y numerosos.' },
  { key: 'threshold', label: 'Umbral', min: 0, max: 1, step: 0.01, hint: 'Mayor = más escaso. A 1 no aparece.' },
];

export const ENEMY_SPECS: Array<ParamSpec<EnemyNumKey>> = [
  { key: 'maxEnemies', label: 'Máximo simultáneo', min: 0, max: 30, step: 1 },
  { key: 'spawnInterval', label: 'Intervalo de aparición (s)', min: 0.5, max: 20, step: 0.5 },
  { key: 'spawnMin', label: 'Distancia mínima de aparición', min: 4, max: 100, step: 1, hint: 'En bloques, en horizontal.' },
  { key: 'spawnMax', label: 'Distancia máxima de aparición', min: 5, max: 140, step: 1, hint: 'Más lejos de lo que hay chunks cargados no aparece nada.' },
  { key: 'aggroRange', label: 'Rango de persecución', min: 5, max: 100, step: 1 },
  { key: 'despawnX', label: 'Desaparece a (horizontal)', min: 20, max: 200, step: 1 },
  { key: 'despawnY', label: 'Desaparece a (vertical)', min: 10, max: 150, step: 1 },
  { key: 'health', label: 'Vida', min: 1, max: 300, step: 1, hint: 'Se aplica a los slimes que aparezcan a partir de ahora.' },
  { key: 'contactDamage', label: 'Daño por contacto', min: 0, max: 100, step: 1 },
];

function clampSpec(spec: ParamSpec<string>, v: unknown, fallback: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  n = Math.min(spec.max, Math.max(spec.min, n));
  return Number.isInteger(spec.step) ? Math.round(n) : n;
}

/** Convierte cualquier entrada (por ejemplo, lo leído de localStorage) en parámetros válidos. */
export function sanitizeGenParams(raw: unknown): GenParams {
  const out = cloneGenParams(DEFAULT_GEN_PARAMS);
  if (typeof raw !== 'object' || raw === null) return out;
  const src = raw as Record<string, unknown>;

  for (const spec of [...SURFACE_SPECS, ...CAVE_SPECS]) {
    out[spec.key] = clampSpec(spec, src[spec.key], out[spec.key]);
  }

  const rawOres: unknown[] = Array.isArray(src.ores) ? src.ores : [];
  for (const ore of out.ores) {
    const found = rawOres.find(
      (o): o is Record<string, unknown> =>
        typeof o === 'object' && o !== null && (o as { id?: unknown }).id === ore.id,
    );
    if (!found) continue;
    for (const spec of ORE_SPECS) ore[spec.key] = clampSpec(spec, found[spec.key], ore[spec.key]);
  }
  return out;
}

/** La distancia máxima de aparición debe ser mayor que la mínima. */
export function normalizeEnemyParams(p: EnemyParams): EnemyParams {
  if (p.spawnMax < p.spawnMin + 1) p.spawnMax = p.spawnMin + 1;
  return p;
}

export function sanitizeEnemyParams(raw: unknown): EnemyParams {
  const out: EnemyParams = { ...DEFAULT_ENEMY_PARAMS };
  if (typeof raw === 'object' && raw !== null) {
    const src = raw as Record<string, unknown>;
    if (typeof src.spawnEnabled === 'boolean') out.spawnEnabled = src.spawnEnabled;
    for (const spec of ENEMY_SPECS) out[spec.key] = clampSpec(spec, src[spec.key], out[spec.key]);
  }
  return normalizeEnemyParams(out);
}

// ---------------------------------------------------------------- persistencia (solo desarrollo)

const DEV_KEY = 'terraria-pixi-dev-config';

export interface DevConfig {
  gen: GenParams;
  enemy: EnemyParams;
}

export function loadDevConfig(): DevConfig {
  try {
    const raw = localStorage.getItem(DEV_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { gen?: unknown; enemy?: unknown };
      return { gen: sanitizeGenParams(data.gen), enemy: sanitizeEnemyParams(data.enemy) };
    }
  } catch {
    /* datos corruptos o localStorage no disponible: valores por defecto */
  }
  return { gen: cloneGenParams(DEFAULT_GEN_PARAMS), enemy: { ...DEFAULT_ENEMY_PARAMS } };
}

export function saveDevConfig(cfg: DevConfig): void {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(cfg));
  } catch {
    /* ignorar */
  }
}