export const BLOCK_SIZE = 16;
export const CHUNK_SIZE = 32;

export const BlockId = {
  AIR: 0,
  DIRT: 1,
  STONE: 2,
  GRASS: 3,
  COAL: 4,
  IRON: 5,
  GOLD: 6,
  TORCH: 7,
} as const;

export type BlockId = (typeof BlockId)[keyof typeof BlockId];

