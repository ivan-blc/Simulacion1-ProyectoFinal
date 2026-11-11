import { Sprite, Texture } from 'pixi.js';
import { BLOCK_SIZE } from '../core/constants';
import { DarknessMap } from '../lighting/darkness';
import type { LightField } from '../lighting/LightField';

// Color de la oscuridad: negro con un toque azul
const DARK_R = 4;
const DARK_G = 6;
const DARK_B = 14;

export class LightRenderer {
  /** Añádelo al contenedor del mundo, por encima de entidades y partículas. */
  readonly sprite = new Sprite();
  /** Pasadas del desenfoque que suaviza las sombras (0 = sin suavizado). */
  blurPasses = 2;

  private readonly map = new DarknessMap();
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
   * Convierte el campo de luz en una textura de `scale` texels por bloque y la coloca sobre el mundo.
   * surf[i] = altura de la superficie en la columna i de la rejilla (para la oscuridad ambiental).
   */
  update(field: LightField, surf: ArrayLike<number>): void {
    const { gw, gh, gx0, gy0 } = field;
    if (gw <= 0 || gh <= 0) return;

    this.map.update(field, surf, this.blurPasses);
    const { w, h, data: dark } = this.map;
    if (!this.texture || w !== this.w || h !== this.h) this.allocate(w, h);

    const px = this.image!.data;
    for (let k = 0, n = w * h; k < n; k++) px[k * 4 + 3] = Math.round(dark[k] * 255);

    this.ctx!.putImageData(this.image!, 0, 0);
    this.texture!.source.update(); // vuelve a subir la textura a la GPU

    this.sprite.position.set(gx0 * BLOCK_SIZE, gy0 * BLOCK_SIZE);
    this.sprite.width = gw * BLOCK_SIZE;
    this.sprite.height = gh * BLOCK_SIZE;
    this.sprite.visible = true;
  }

  private allocate(w: number, h: number): void {
    this.texture?.destroy(true);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    this.ctx = ctx;

    const image = ctx.createImageData(w, h);
    for (let k = 0, n = w * h; k < n; k++) {
      image.data[k * 4] = DARK_R;
      image.data[k * 4 + 1] = DARK_G;
      image.data[k * 4 + 2] = DARK_B;
    }
    this.image = image;

    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'linear'; // el filtro bilineal suaviza lo que queda entre muestras
    this.texture = tex;
    this.sprite.texture = tex;
    this.w = w;
    this.h = h;
  }
}