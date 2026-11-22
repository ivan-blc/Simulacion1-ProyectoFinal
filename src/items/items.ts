import { BLOCK_INFO } from '../core/blockInfo';
import { BlockId } from '../core/constants';
import { PixelMat } from '../pixels/materials';

/** Máximo apilable de un bloque. */
export const BLOCK_STACK = 999;

export const ItemId = {
  WAND_WATER: 101,
  WAND_SAND: 102,
  WAND_LAVA: 103,
  WAND_OIL: 104,
  WAND_SMOKE: 105,
} as const;

export interface WandInfo {
  /** Material (PixelMat) que lanza. */
  material: number;
  /** Proyectiles por segundo. */
  rate: number;
  /** Velocidad de salida (px/s). */
  speed: number;
  /** Dispersión total, en radianes. */
  spread: number;
  /** Segundos de vuelo antes de depositarse donde esté. */
  life: number;
  /** Daño a un enemigo alcanzado (0 = solo empuja). */
  damage: number;
}

export const WANDS: Record<number, WandInfo> = {
  [ItemId.WAND_WATER]: { material: PixelMat.WATER, rate: 220, speed: 330, spread: 0.16, life: 1.6, damage: 0 },
  [ItemId.WAND_SAND]: { material: PixelMat.SAND, rate: 170, speed: 340, spread: 0.2, life: 1.6, damage: 0.6 },
  [ItemId.WAND_LAVA]: { material: PixelMat.LAVA, rate: 90, speed: 320, spread: 0.12, life: 1.6, damage: 1.6 },
  [ItemId.WAND_OIL]: { material: PixelMat.OIL, rate: 160, speed: 320, spread: 0.16, life: 1.6, damage: 0 },
  [ItemId.WAND_SMOKE]: { material: PixelMat.SMOKE, rate: 130, speed: 230, spread: 0.45, life: 1.0, damage: 0 },
};

export interface ItemInfo {
  name: string;
  color: string;
  /** Símbolo que se dibuja sobre el color en la barra de acceso rápido. */
  glyph?: string;
}

const WAND_INFO: Record<number, ItemInfo> = {
  [ItemId.WAND_WATER]: { name: 'varita de agua', color: '#3b8cff', glyph: '✦' },
  [ItemId.WAND_SAND]: { name: 'varita de arena', color: '#d8b84e', glyph: '✦' },
  [ItemId.WAND_LAVA]: { name: 'varita de lava', color: '#ff5a1a', glyph: '✦' },
  [ItemId.WAND_OIL]: { name: 'varita de aceite', color: '#c4a030', glyph: '✦' },
  [ItemId.WAND_SMOKE]: { name: 'varita de humo', color: '#9a9590', glyph: '✦' },
};

export function isWand(id: number): boolean {
  return id in WANDS;
}

/** ¿Es un bloque colocable? */
export function isBlockItem(id: number): id is BlockId {
  return id !== BlockId.AIR && id in BLOCK_INFO;
}

export function isValidItem(id: number): boolean {
  return isBlockItem(id) || isWand(id);
}

export function maxStack(id: number): number {
  return isWand(id) ? 1 : BLOCK_STACK;
}

export function itemInfo(id: number): ItemInfo {
  return WAND_INFO[id] ?? BLOCK_INFO[id] ?? { name: '?', color: '#ff00ff' };
}