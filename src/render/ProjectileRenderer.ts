import { Container, Sprite, Texture } from 'pixi.js';
import { CELL_PX, PIXEL_INFO } from '../pixels/materials';
import { PROJECTILE } from '../sim/Projectiles';
import type { ProjectileSystem } from '../sim/Projectiles';

export class ProjectileRenderer {
  /** Añádelo al contenedor del mundo. */
  readonly container = new Container();
  private readonly sprites: Sprite[] = [];

  constructor() {
    for (let i = 0; i < PROJECTILE.MAX; i++) {
      const s = new Sprite(Texture.WHITE);
      s.anchor.set(0.5);
      s.width = CELL_PX;
      s.height = CELL_PX;
      s.visible = false;
      this.container.addChild(s);
      this.sprites.push(s);
    }
  }

  sync(system: ProjectileSystem): void {
    const list = system.list;
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (i < list.length) {
        const p = list[i];
        s.position.set(p.x, p.y);
        s.tint = PIXEL_INFO[p.material].color;
        s.visible = true;
      } else {
        s.visible = false;
      }
    }
  }
}