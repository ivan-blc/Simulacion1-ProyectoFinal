import { Container, Sprite, Texture } from 'pixi.js';

const MAX_PARTICLES = 300;
const GRAVITY = 700; // px/s²

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class Particles {
  /** Añádelo al contenedor del mundo. */
  readonly container = new Container();
  activeCount = 0;

  private readonly list: Particle[] = [];
  private next = 0;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const sprite = new Sprite(Texture.WHITE);
      sprite.visible = false;
      this.container.addChild(sprite);
      this.list.push({ sprite, vx: 0, vy: 0, life: 0, maxLife: 1 });
    }
  }

  /** Estalla `count` partículas en (x, y), en píxeles del mundo. */
  burst(x: number, y: number, color: number, count = 7, speed = 80): void {
    for (let i = 0; i < count; i++) {
      const p = this.list[this.next];
      this.next = (this.next + 1) % MAX_PARTICLES;

      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v - speed * 0.6; // sesgo hacia arriba
      p.maxLife = 0.35 + Math.random() * 0.35;
      p.life = p.maxLife;

      const size = 2 + Math.floor(Math.random() * 2);
      p.sprite.width = size;
      p.sprite.height = size;
      p.sprite.tint = color;
      p.sprite.alpha = 1;
      p.sprite.position.set(x, y);
      p.sprite.visible = true;
    }
  }

  update(dt: number): void {
    let active = 0;
    for (const p of this.list) {
      if (!p.sprite.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      p.vy += GRAVITY * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.alpha = Math.min(1, (p.life / p.maxLife) * 1.5);
      active++;
    }
    this.activeCount = active;
  }
}