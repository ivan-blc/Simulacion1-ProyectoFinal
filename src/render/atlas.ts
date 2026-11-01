import { Rectangle, Texture } from 'pixi.js';
import { BLOCK_INFO } from '../core/blockInfo';
import { BLOCK_SIZE, BlockId } from '../core/constants';

const ORE_DOTS: Array<[number, number]> = [[3, 3], [10, 4], [6, 10], [11, 11]];

export function createBlockTextures(): Texture[] {
  const count = Object.keys(BLOCK_INFO).length;
  const canvas = document.createElement('canvas');
  canvas.width = BLOCK_SIZE * count;
  canvas.height = BLOCK_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let id = 0; id < count; id++) {
    const info = BLOCK_INFO[id];
    const ox = id * BLOCK_SIZE;

    ctx.fillStyle = info.base ?? info.color;
    ctx.fillRect(ox, 0, BLOCK_SIZE, BLOCK_SIZE);

    if (info.base) {
      ctx.fillStyle = info.color; // minerales: puntos de color sobre piedra
      for (const [dx, dy] of ORE_DOTS) ctx.fillRect(ox + dx, dy, 3, 3);
    }
    if (id !== BlockId.AIR) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.strokeRect(ox + 0.5, 0.5, BLOCK_SIZE - 1, BLOCK_SIZE - 1);
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

export function createBackgroundTextures(): { sky: Texture; cave: Texture } {
  const make = (color: string): Texture => {
    const canvas = document.createElement('canvas');
    canvas.width = BLOCK_SIZE;
    canvas.height = BLOCK_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    return tex;
  };
  return { sky: make('#6ec0ff'), cave: make('#1c1622') };
}