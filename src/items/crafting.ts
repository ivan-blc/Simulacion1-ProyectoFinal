import { BlockId } from '../core/constants';
import type { Inventory } from './Inventory';

export const TORCH_RECIPE = { coal: 1, torches: 4 } as const;

export type CraftResult = 'ok' | 'no-coal' | 'full';

/** 1 carbón -> 4 antorchas. */
export function craftTorches(inv: Inventory): CraftResult {
  if (inv.count(BlockId.COAL) < TORCH_RECIPE.coal) return 'no-coal';
  if (!inv.canAdd(BlockId.TORCH, TORCH_RECIPE.torches)) return 'full';
  inv.remove(BlockId.COAL, TORCH_RECIPE.coal);
  inv.add(BlockId.TORCH, TORCH_RECIPE.torches);
  return 'ok';
}