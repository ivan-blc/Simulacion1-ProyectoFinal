import type { EnemyManager } from '../entities/EnemyManager';
import type { WandInfo } from '../items/items';
import { CELL_PX } from '../pixels/materials';
import type { PixelSim } from '../pixels/PixelSim';

export const PROJECTILE = {
  GRAVITY: 520, // px/s²
  STEP_PX: CELL_PX, // avance máximo por iteración: una celda, así no atraviesan nada
  MAX: 900, // proyectiles vivos a la vez
} as const;

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /** Material (PixelMat) en el que se convierte al terminar. */
  material: number;
  damage: number;
  /** Última celda libre que atravesó (rejilla global de píxeles): ahí se deposita. */
  lastX: number;
  lastY: number;
  hasLast: boolean;
}

/**
 * Ángulo de tiro (con el eje Y hacia arriba) para que una parábola con gravedad `g` y velocidad `v`
 * pase por un objetivo a (dx, dyUp) píxeles. Usa el arco bajo; fuera de alcance, 45°.
 */
export function aimAngle(dx: number, dyUp: number, v: number, g: number): number {
  const ax = Math.abs(dx);
  if (ax < 4) return dyUp >= 0 ? Math.PI / 2 : -Math.PI / 2;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * ax * ax + 2 * dyUp * v2);
  const theta = disc < 0 ? Math.PI / 4 : Math.atan((v2 - Math.sqrt(disc)) / (g * ax));
  return dx >= 0 ? theta : Math.PI - theta;
}

export class ProjectileSystem {
  readonly list: Projectile[] = [];
  onDeposit?: (x: number, y: number, material: number) => void;

  private shotAcc = 1;
  private readonly pixels: PixelSim;
  private readonly enemies: EnemyManager;
  private readonly rand: () => number;

  constructor(pixels: PixelSim, enemies: EnemyManager, rand: () => number = Math.random) {
    this.pixels = pixels;
    this.enemies = enemies;
    this.rand = rand;
  }

  /** Llamar cuando no se está disparando: el siguiente disparo sale al instante. */
  idle(): void {
    this.shotAcc = 1;
  }

  /** Dispara desde (ox, oy) hacia (tx, ty), en píxeles del mundo. Devuelve cuántos proyectiles salieron. */
  fire(spec: WandInfo, ox: number, oy: number, tx: number, ty: number, dt: number): number {
    this.shotAcc += spec.rate * Math.min(dt, 0.1);
    const shots = Math.floor(this.shotAcc);
    this.shotAcc -= shots;

    const aim = aimAngle(tx - ox, -(ty - oy), spec.speed, PROJECTILE.GRAVITY);
    let fired = 0;
    for (let i = 0; i < shots; i++) {
      if (this.list.length >= PROJECTILE.MAX) break;
      const ang = aim + (this.rand() - 0.5) * spec.spread;
      const speed = spec.speed * (0.92 + 0.16 * this.rand());
      this.spawn(spec.material, ox, oy, Math.cos(ang) * speed, -Math.sin(ang) * speed, spec.life, spec.damage);
      fired++;
    }
    return fired;
  }

  spawn(material: number, x: number, y: number, vx: number, vy: number, life: number, damage: number): void {
    if (this.list.length >= PROJECTILE.MAX) return;
    this.list.push({ x, y, vx, vy, life, material, damage, lastX: 0, lastY: 0, hasLast: false });
  }

  update(dt: number): void {
    const step = Math.min(dt, 1 / 30);
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.advance(this.list[i], step)) {
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
      }
    }
  }

  /** Devuelve true cuando el proyectil termina (choca, impacta o se le acaba el tiempo). */
  private advance(p: Projectile, dt: number): boolean {
    p.life -= dt;
    p.vy += PROJECTILE.GRAVITY * dt;

    const dist = Math.max(Math.abs(p.vx), Math.abs(p.vy)) * dt;
    const n = Math.max(1, Math.ceil(dist / PROJECTILE.STEP_PX));
    const h = dt / n;

    for (let s = 0; s < n; s++) {
      p.x += p.vx * h;
      p.y += p.vy * h;

      const hit = this.enemies.hitTest(p.x, p.y, 1);
      if (hit) {
        const dir = p.vx >= 0 ? 1 : -1;
        if (p.damage > 0) {
          // Hay muchos proyectiles por segundo: cada impacto empuja solo un poco
          if (hit.damage(p.damage, dir, 0.12)) this.enemies.remove(hit);
        } else {
          hit.vx = Math.max(-110, Math.min(110, hit.vx + dir * 6)); // el agua solo empuja
        }
        this.finish(p);
        return true;
      }

      const cx = Math.floor(p.x / CELL_PX);
      const cy = Math.floor(p.y / CELL_PX);
      if (this.pixels.isSolidCell(cx, cy)) {
        this.finish(p); // el terreno (o un chunk sin cargar) lo detiene
        return true;
      }
      p.lastX = cx; // el resto de píxeles se atraviesan
      p.lastY = cy;
      p.hasLast = true;
    }

    if (p.life <= 0) {
      this.finish(p);
      return true;
    }
    return false;
  }

  /** Convierte el proyectil en un píxel de la simulación, en la última celda libre que recorrió. */
  private finish(p: Projectile): void {
    if (p.hasLast && this.pixels.deposit(p.lastX, p.lastY, p.material)) {
      this.onDeposit?.(p.lastX, p.lastY, p.material);
    }
  }
}