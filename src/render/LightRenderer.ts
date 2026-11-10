import { Sprite, Texture } from 'pixi.js';
import { BLOCK_SIZE } from '../core/constants';
import { ambientAtDepth } from '../lighting/LightField';
import type { LightField } from '../lighting/LightField';

// Color de la oscuridad: negro con un toque azul
const DARK_R = 4;
const DARK_G = 6;
const DARK_B = 14;

export class LightRenderer {
  /** Añádelo al contenedor del mundo, por encima de entidades y partículas. */
  readonly sprite = new Sprite();

  private ctx: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private texture: Texture | null = null;
  private w = 0;
  private h = 0;

  constructor() {
    this.sprite.visible = false;
  }

  hide(): void {
    this.sprite.visible = false;
  }

  /**
   * Convierte el campo de luz en una textura de 1 texel por bloque y la coloca sobre el mundo.
   * surf[i] = altura de la superficie en la columna i de la rejilla (para la oscuridad ambiental).
   */
  update(field: LightField, surf: ArrayLike<number>): void {
    const { gw, gh, gx0, gy0 } = field;
    if (gw <= 0 || gh <= 0) return;
    if (!this.texture || gw !== this.w || gh !== this.h) this.allocate(gw, gh);

    const data = this.image!.data;
    const unlit = field.unlit;
    for (let j = 0; j < gh; j++) {
      const by = gy0 + j;
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const dark = ambientAtDepth(by - surf[i]) * unlit[k];
        const o = k * 4;
        data[o] = DARK_R;
        data[o + 1] = DARK_G;
        data[o + 2] = DARK_B;
        data[o + 3] = Math.round(dark * 255);
      }
    }

    this.ctx!.putImageData(this.image!, 0, 0);
    this.texture!.source.update(); // vuelve a subir la textura a la GPU

    this.sprite.position.set(gx0 * BLOCK_SIZE, gy0 * BLOCK_SIZE);
    this.sprite.width = gw * BLOCK_SIZE;
    this.sprite.height = gh * BLOCK_SIZE;
    this.sprite.visible = true;
  }

  private allocate(gw: number, gh: number): void {
    this.texture?.destroy(true);
    const canvas = document.createElement('canvas');
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext('2d')!;
    this.ctx = ctx;
    this.image = ctx.createImageData(gw, gh);

    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'linear'; // el filtro bilineal suaviza la rejilla de bloques
    this.texture = tex;
    this.sprite.texture = tex;
    this.w = gw;
    this.h = gh;
  }
}