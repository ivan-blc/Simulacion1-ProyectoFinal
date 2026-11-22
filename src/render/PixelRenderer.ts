import { Container, Sprite, Texture } from 'pixi.js';
import { CELL_PX, CHUNK_PIX, PixelMat, TONES, TONE_SHIFT } from '../pixels/materials';
import type { PixelLayer, PixelSim } from '../pixels/PixelSim';

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
/** Empaqueta RGBA como un entero little-endian (el orden de bytes de ImageData en cualquier navegador actual). */
const pack = (r: number, g: number, b: number, a: number): number => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** Variaciones de tono por partícula (las mismas 4 del archivo de referencia). */
const TONE_DELTA = [-14, -4, 6, 16];

function palette(r: number, g: number, b: number, a: number): Uint32Array {
  const out = new Uint32Array(TONES);
  for (let v = 0; v < TONES; v++) {
    const d = TONE_DELTA[v];
    out[v] = pack(clamp(r + d), clamp(g + d), clamp(b + d), a);
  }
  return out;
}

/** [normal, superficie]. Arena y agua usan los colores base del archivo de referencia. */
const PAL: Record<number, [Uint32Array, Uint32Array]> = {
  [PixelMat.SAND]: [palette(222, 178, 108, 255), palette(240, 204, 132, 255)],
  [PixelMat.WATER]: [palette(58, 122, 196, 215), palette(150, 205, 250, 235)],
  [PixelMat.LAVA]: [palette(230, 84, 20, 255), palette(255, 205, 80, 255)],
  [PixelMat.OIL]: [palette(196, 160, 48, 235), palette(222, 190, 90, 240)],
  [PixelMat.SMOKE]: [palette(140, 136, 132, 170), palette(150, 146, 142, 170)],
};

interface View {
  sprite: Sprite;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  px32: Uint32Array;
  texture: Texture;
}

export class PixelRenderer {
  /** Añádelo al contenedor del mundo, encima de los chunks y debajo de las entidades. */
  readonly container = new Container();
  private readonly views = new Map<PixelLayer, View>();

  /** Actualiza las capas visibles y libera las que ya no se ven. Llamar una vez por frame. */
  sync(pixels: PixelSim, left: number, top: number, right: number, bottom: number): void {
    const size = CHUNK_PIX * CELL_PX;
    const seen = new Set<PixelLayer>();

    for (const layer of pixels.layers.values()) {
      const x = layer.cx * size;
      const y = layer.cy * size;
      if (layer.count === 0 || x >= right || x + size <= left || y >= bottom || y + size <= top) continue;
      seen.add(layer);

      let view = this.views.get(layer);
      if (!view) {
        view = this.createView(layer);
        this.views.set(layer, view);
        layer.renderDirty = true;
      }
      if (layer.renderDirty) this.rebuild(layer, view);
      view.sprite.visible = true;
    }

    for (const [layer, view] of this.views) {
      if (seen.has(layer)) continue;
      this.container.removeChild(view.sprite);
      view.sprite.destroy();
      view.texture.destroy(true);
      this.views.delete(layer);
    }
  }

  private createView(layer: PixelLayer): View {
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_PIX;
    canvas.height = CHUNK_PIX;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(CHUNK_PIX, CHUNK_PIX);
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    const sprite = new Sprite(texture);
    sprite.scale.set(CELL_PX);
    sprite.position.set(layer.cx * CHUNK_PIX * CELL_PX, layer.cy * CHUNK_PIX * CELL_PX);
    this.container.addChild(sprite);
    return { sprite, ctx, image, px32: new Uint32Array(image.data.buffer), texture };
  }

  private rebuild(layer: PixelLayer, view: View): void {
    const cells = layer.cells;
    const meta = layer.meta;
    const out = view.px32;
    for (let i = 0; i < cells.length; i++) {
      const m = cells[i];
      if (m === 0) {
        out[i] = 0;
        continue;
      }
      const tone = (meta[i] >> TONE_SHIFT) & (TONES - 1); // el tono viaja con la partícula
      const top = i >= CHUNK_PIX && cells[i - CHUNK_PIX] === 0; // la fila de arriba no cuenta como superficie
      out[i] = PAL[m][top ? 1 : 0][tone];
    }
    view.ctx.putImageData(view.image, 0, 0);
    view.texture.source.update(); // vuelve a subir la textura a la GPU
    layer.renderDirty = false;
  }
}