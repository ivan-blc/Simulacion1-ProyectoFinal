import { Container, Graphics } from 'pixi.js';
import type { Enemy } from '../entities/Enemy';

export class EnemyRenderer {
  /** Añádelo al contenedor del mundo. */
  readonly container = new Container();
  private readonly views = new Map<Enemy, Graphics>();

  add(e: Enemy): void {
    const g = new Graphics();
    g.roundRect(0, 0, e.width, e.height, 4).fill(0x4cd964);
    g.rect(3, 3, 2, 3).fill(0x000000);
    g.rect(e.width - 5, 3, 2, 3).fill(0x000000);
    this.container.addChild(g);
    this.views.set(e, g);
  }

  remove(e: Enemy): void {
    const g = this.views.get(e);
    if (!g) return;
    this.container.removeChild(g);
    g.destroy();
    this.views.delete(e);
  }

  /** Posición y destello de daño. Llamar una vez por frame. */
  sync(): void {
    for (const [e, g] of this.views) {
      g.position.set(e.x, e.y);
      g.tint = e.hurtTimer > 0 ? 0xff7777 : 0xffffff;
    }
  }
}