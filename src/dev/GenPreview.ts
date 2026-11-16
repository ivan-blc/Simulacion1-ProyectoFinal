import { BLOCK_INFO, colorToNumber } from '../core/blockInfo';
import { BlockId, CHUNK_SIZE } from '../core/constants';
import { Chunk } from '../world/Chunk';
import { WorldGenerator } from '../world/WorldGenerator';
import type { GenParams } from '../world/genParams';

export const PREVIEW_W = 320; // bloques
export const PREVIEW_H = 160;

type RGB = [number, number, number];

const SKY: RGB = [110, 192, 255];
const CAVE: RGB = [28, 22, 34];

/** Color por id de bloque (el aire se resuelve aparte). */
const PALETTE: RGB[] = Object.keys(BLOCK_INFO).map((k) => {
  const c = colorToNumber(BLOCK_INFO[Number(k)].color);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
});

export class GenPreview {
  readonly canvas = document.createElement('canvas');

  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.canvas.width = PREVIEW_W;
    this.canvas.height = PREVIEW_H;
    this.canvas.style.cssText =
      'width:100%;display:block;image-rendering:pixelated;border:1px solid #334;background:#000';
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(PREVIEW_W, PREVIEW_H);
  }

  /**
   * Dibuja la región centrada en la columna `centerBx`, empezando 24 bloques sobre su superficie.
   * Devuelve los milisegundos que tardó.
   */
  render(params: GenParams, centerBx: number): number {
    const t0 = performance.now();
    const gen = new WorldGenerator(this.seed, params);
    const x0 = centerBx - PREVIEW_W / 2;
    const y0 = gen.surfaceHeight(centerBx) - 24;

    const heights = new Int32Array(PREVIEW_W);
    for (let i = 0; i < PREVIEW_W; i++) heights[i] = gen.surfaceHeight(x0 + i);

    const d = this.image.data;
    const cx0 = Math.floor(x0 / CHUNK_SIZE);
    const cx1 = Math.floor((x0 + PREVIEW_W - 1) / CHUNK_SIZE);
    const cy0 = Math.floor(y0 / CHUNK_SIZE);
    const cy1 = Math.floor((y0 + PREVIEW_H - 1) / CHUNK_SIZE);

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = new Chunk(cx, cy);
        gen.generateChunk(chunk);
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const by = cy * CHUNK_SIZE + ly;
          const py = by - y0;
          if (py < 0 || py >= PREVIEW_H) continue;
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const px = cx * CHUNK_SIZE + lx - x0;
            if (px < 0 || px >= PREVIEW_W) continue;
            const id = chunk.blocks[ly * CHUNK_SIZE + lx];
            const rgb = id === BlockId.AIR ? (by < heights[px] ? SKY : CAVE) : PALETTE[id];
            const o = (py * PREVIEW_W + px) * 4;
            d[o] = rgb[0];
            d[o + 1] = rgb[1];
            d[o + 2] = rgb[2];
            d[o + 3] = 255;
          }
        }
      }
    }

    this.ctx.putImageData(this.image, 0, 0);
    // Marca roja en la columna del jugador
    this.ctx.fillStyle = '#ff4d4d';
    this.ctx.fillRect(PREVIEW_W / 2 - 1, 0, 3, 5);
    return performance.now() - t0;
  }
}