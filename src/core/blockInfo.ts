import { BlockId } from './constants';

export interface BlockLight {
  /** Radio de la luz, en bloques. */
  radius: number;
  /** Intensidad en el centro (0..1). */
  intensity: number;
}

export interface BlockInfo {
  name: string;
  /** Color del bloque (o de los puntos del mineral). También se usa en la interfaz. */
  color: string;
  /** Solo minerales: color de fondo sobre el que se dibujan los puntos. */
  base?: string;
  /** Qué ítem suelta al minarlo (null = nada). */
  drop: BlockId | null;
  /** Sólido: colisiona, se dibuja como terreno y bloquea la luz. */
  solid: boolean;
  /** Si emite luz. */
  light?: BlockLight;
}

const STONE_COLOR = '#7a7a7a';

export const BLOCK_INFO: Record<number, BlockInfo> = {
  [BlockId.AIR]: { name: 'aire', color: 'rgba(0,0,0,0)', drop: null, solid: false },
  [BlockId.DIRT]: { name: 'tierra', color: '#8b5a2b', drop: BlockId.DIRT, solid: true },
  [BlockId.STONE]: { name: 'piedra', color: STONE_COLOR, drop: BlockId.STONE, solid: true },
  [BlockId.GRASS]: { name: 'pasto', color: '#4caf50', drop: BlockId.DIRT, solid: true },
  [BlockId.COAL]: { name: 'carbón', color: '#2b2b2b', base: STONE_COLOR, drop: BlockId.COAL, solid: true },
  [BlockId.IRON]: { name: 'hierro', color: '#d9a47c', base: STONE_COLOR, drop: BlockId.IRON, solid: true },
  [BlockId.GOLD]: { name: 'oro', color: '#f2c94c', base: STONE_COLOR, drop: BlockId.GOLD, solid: true },
  [BlockId.TORCH]: {
    name: 'antorcha',
    color: '#ffb02e',
    drop: BlockId.TORCH,
    solid: false,
    light: { radius: 8, intensity: 0.95 },
  },
};

const SOLID_TABLE = new Uint8Array(256);
for (const [key, info] of Object.entries(BLOCK_INFO)) {
  if (info.solid) SOLID_TABLE[Number(key)] = 1;
}

/** ¿Colisiona y bloquea la luz? El aire y las antorchas, no. */
export function isSolidBlock(id: number): boolean {
  return SOLID_TABLE[id] === 1;
}

export function dropFor(id: number): BlockId | null {
  return BLOCK_INFO[id]?.drop ?? null;
}

/** '#rrggbb' -> 0xrrggbb (para tintes de Pixi). Cualquier otro formato devuelve blanco. */
export function colorToNumber(css: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  return m ? parseInt(m[1], 16) : 0xffffff;
}