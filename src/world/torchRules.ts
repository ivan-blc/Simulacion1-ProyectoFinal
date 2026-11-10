import { isSolidBlock } from '../core/blockInfo';

/** Una antorcha necesita un bloque sólido a la izquierda, a la derecha o debajo. */
export function torchHasSupport(
  getBlock: (bx: number, by: number) => number,
  bx: number,
  by: number,
): boolean {
  return (
    isSolidBlock(getBlock(bx - 1, by)) ||
    isSolidBlock(getBlock(bx + 1, by)) ||
    isSolidBlock(getBlock(bx, by + 1))
  );
}