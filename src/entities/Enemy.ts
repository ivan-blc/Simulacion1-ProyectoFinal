import { PhysicsBody } from '../player/PhysicsBody';
import { PLAYER } from '../player/playerParams';
import type { WorldManager } from '../world/WorldManager';

export const SLIME = {
  WIDTH: 14,
  HEIGHT: 12,
  HEALTH: 20,
  DAMAGE: 10,         // daño por contacto
  JUMP_SPEED: 400,    // salto de ~2,8 bloques: supera muros de 2
  JUMP_VX: 100,       // velocidad horizontal en el aire
  DELAY_MIN: 0.6,     // s entre saltos
  DELAY_MAX: 1.4,
} as const;

export class Enemy extends PhysicsBody {
  health: number = SLIME.HEALTH;
  /** Segundos restantes del destello rojo tras un golpe. */
  hurtTimer = 0;

  private jumpTimer: number;
  private dir = 1;

  constructor(world: WorldManager, x: number, y: number) {
    super(world, SLIME.WIDTH, SLIME.HEIGHT, false);
    this.x = x;
    this.y = y;
    this.jumpTimer = this.randomDelay();
  }

  get cx(): number {
    return this.x + this.width / 2;
  }

  get cy(): number {
    return this.y + this.height / 2;
  }

  /** Aplica daño con retroceso. Devuelve true si el enemigo muere. */
  damage(amount: number, dirX: number): boolean {
    this.health -= amount;
    this.hurtTimer = 0.2;
    this.vx = dirX * 160;
    this.vy = -200;
    this.onGround = false;
    return this.health <= 0;
  }

  update(dt: number, targetX: number, aggro: boolean): void {
    const clamped = Math.min(dt, PLAYER.MAX_DT);
    if (clamped <= 0) return;
    this.hurtTimer = Math.max(0, this.hurtTimer - clamped);

    const n = Math.ceil(clamped / PLAYER.SUBSTEP);
    const h = clamped / n;
    for (let i = 0; i < n; i++) this.step(h, targetX, aggro);
  }

  private step(h: number, targetX: number, aggro: boolean): void {
    if (this.onGround) {
      this.vx = 0; // al aterrizar no se desliza
      this.jumpTimer -= h;
      if (aggro && this.jumpTimer <= 0) {
        const dx = targetX - this.cx;
        if (dx !== 0) this.dir = dx > 0 ? 1 : -1;
        this.vy = -SLIME.JUMP_SPEED;
        this.vx = this.dir * SLIME.JUMP_VX;
        this.onGround = false;
        this.jumpTimer = this.randomDelay();
      }
    }

    this.vy = Math.min(this.vy + PLAYER.GRAVITY * h, PLAYER.MAX_FALL);
    this.moveX(this.vx * h);
    this.moveY(this.vy * h);
  }

  private randomDelay(): number {
    return SLIME.DELAY_MIN + Math.random() * (SLIME.DELAY_MAX - SLIME.DELAY_MIN);
  }
}