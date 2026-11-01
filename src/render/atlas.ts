import { Rectangle, Texture } from 'pixi.js';
import { BLOCK_SIZE, BlockId } from '../core/constants';

const COLORS: Record<number, string> = {
  [BlockId.AIR]: 'rgba(0,0,0,0)',
  [BlockId.DIRT]: '#8b5a2b',
  [BlockId.STONE]: '#7a7a7a',
  [BlockId.GRASS]: '#4caf50',
};

export function createBlockTextures(): Texture[] {
  const count = Object.keys(COLORS).length;
  const canvas = document.createElement('canvas');
  canvas.width = BLOCK_SIZE * count;
  canvas.height = BLOCK_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let id = 0; id < count; id++) {
    ctx.fillStyle = COLORS[id];
    ctx.fillRect(id * BLOCK_SIZE, 0, BLOCK_SIZE, BLOCK_SIZE);
    if (id !== BlockId.AIR) {            // borde para distinguir bloques
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.strokeRect(id * BLOCK_SIZE + 0.5, 0.5, BLOCK_SIZE - 1, BLOCK_SIZE - 1);
    }
  }

  const base = Texture.from(canvas);
  base.source.scaleMode = 'nearest';
  return Array.from({ length: count }, (_, id) =>
    new Texture({
      source: base.source,
      frame: new Rectangle(id * BLOCK_SIZE, 0, BLOCK_SIZE, BLOCK_SIZE),
    }),
  );
}