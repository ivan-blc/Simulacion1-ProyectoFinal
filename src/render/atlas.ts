import { Texture } from 'pixi.js';
import { BLOCK_INFO, colorToNumber } from '../core/blockInfo';
import { BLOCK_SIZE, BlockId } from '../core/constants';
import { mulberry32 } from '../core/random';
import { TILE_PX } from './smoothing';

const ORE_DOTS: Array<[number, number]> = [[4, 5], [18, 3], [10, 19], [24, 22], [27, 10], [6, 27]];

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Textura repetible TILE_PX x TILE_PX de un material. */
function makeTile(id: number): Texture {
  const info = BLOCK_INFO[id];
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(1000 + id * 7919);

  const noisy = (color: number, x: number, y: number, w: number, h: number, amount: number) => {
    const r0 = (color >> 16) & 255;
    const g0 = (color >> 8) & 255;
    const b0 = color & 255;
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const d = (rand() - 0.5) * amount;
        ctx.fillStyle = `rgb(${clampByte(r0 + d)},${clampByte(g0 + d)},${clampByte(b0 + d)})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  };

  noisy(colorToNumber(info.base ?? info.color), 0, 0, TILE_PX, TILE_PX, 18);
  if (info.base) {
    const dot = colorToNumber(info.color);
    for (const [dx, dy] of ORE_DOTS) noisy(dot, dx, dy, 3, 3, 24);
  }

  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  tex.source.addressMode = 'repeat'; // imprescindible: las UV superan 1 (y son negativas en el margen)
  return tex;
}

/** Una textura repetible por id de bloque (el aire no se dibuja). */
export function createTileTextures(): Texture[] {
  const count = Object.keys(BLOCK_INFO).length;
  return Array.from({ length: count }, (_, id) => (id === BlockId.AIR ? Texture.EMPTY : makeTile(id)));
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