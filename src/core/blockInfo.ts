import { BlockId } from './constants';

export interface BlockInfo {
  name: string;
  /** Color del bloque (o de los puntos del mineral). También se usa en la interfaz. */
  color: string;
  /** Solo minerales: color de fondo sobre el que se dibujan los puntos. */
  base?: string;
  /** Qué ítem suelta al minarlo (null = nada). */
  drop: BlockId | null;
}

const STONE_COLOR = '#7a7a7a';

export const BLOCK_INFO: Record<number, BlockInfo> = {
  [BlockId.AIR]: { name: 'aire', color: 'rgba(0,0,0,0)', drop: null },
  [BlockId.DIRT]: { name: 'tierra', color: '#8b5a2b', drop: BlockId.DIRT },
  [BlockId.STONE]: { name: 'piedra', color: STONE_COLOR, drop: BlockId.STONE },
  [BlockId.GRASS]: { name: 'pasto', color: '#4caf50', drop: BlockId.DIRT },
  [BlockId.COAL]: { name: 'carbón', color: '#2b2b2b', base: STONE_COLOR, drop: BlockId.COAL },
  [BlockId.IRON]: { name: 'hierro', color: '#d9a47c', base: STONE_COLOR, drop: BlockId.IRON },
  [BlockId.GOLD]: { name: 'oro', color: '#f2c94c', base: STONE_COLOR, drop: BlockId.GOLD },
};

export function dropFor(id: number): BlockId | null {
  return BLOCK_INFO[id]?.drop ?? null;
}