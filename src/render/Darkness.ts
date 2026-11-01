import { Container, Sprite, Texture } from 'pixi.js';

export class Darkness {
  /** Añádelo al stage por ENCIMA del contenedor del mundo. */
  readonly container = new Container();
  private readonly hole: Sprite;
  private readonly bars: Sprite[];

  constructor() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(0,0,0,0)'); // núcleo totalmente iluminado
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    this.hole = new Sprite(Texture.from(canvas)); // escalado suave: el degradado no es pixel art
    this.bars = [0, 1, 2, 3].map(() => {
      const s = new Sprite(Texture.WHITE);
      s.tint = 0x000000;
      return s;
    });
    this.container.addChild(this.hole, ...this.bars);
    this.container.visible = false;
  }

  /**
   * cx, cy: centro de la luz en píxeles de pantalla.
   * radius: radio de la luz en píxeles de pantalla.
   * level: oscuridad de 0 (nada) a 1 (máxima).
   */
  update(screenW: number, screenH: number, cx: number, cy: number, radius: number, level: number): void {
    this.container.visible = level > 0.01;
    if (!this.container.visible) return;

    const d = Math.round(radius * 2);
    const x0 = Math.round(cx - radius);
    const y0 = Math.round(cy - radius);

    this.hole.position.set(x0, y0);
    this.hole.width = d;
    this.hole.height = d;

    const [top, bottom, left, right] = this.bars;
    top.position.set(0, 0);
    top.width = screenW;
    top.height = Math.max(0, y0);

    bottom.position.set(0, y0 + d);
    bottom.width = screenW;
    bottom.height = Math.max(0, screenH - (y0 + d));

    left.position.set(0, y0);
    left.width = Math.max(0, x0);
    left.height = d;

    right.position.set(x0 + d, y0);
    right.width = Math.max(0, screenW - (x0 + d));
    right.height = d;

    this.container.alpha = level;
  }
}