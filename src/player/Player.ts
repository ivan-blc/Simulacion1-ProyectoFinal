import { BLOCK_SIZE } from '../core/constants';
import type { WorldManager } from '../world/WorldManager';
import { PhysicsBody } from './PhysicsBody';
import { PLAYER } from './playerParams';

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
}

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

export class Player extends PhysicsBody {
  health: number = PLAYER.MAX_HEALTH;
  readonly maxHealth: number = PLAYER.MAX_HEALTH;
  /** Segundos de invulnerabilidad restantes tras un golpe. */
  invuln = 0;

  private coyote = 0;
  private jumpBuffer = 0;
  private jumpPrev = false;
  private jumping = false;

  constructor(world: WorldManager) {
    super(world, PLAYER.WIDTH, PLAYER.HEIGHT, PLAYER.AUTO_STEP);
  }

  respawn(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumping = false;
    this.health = this.maxHealth;
    this.invuln = 0;
  }

  update(dt: number, input: InputState): void {
    const clamped = Math.min(dt, PLAYER.MAX_DT);
    if (clamped <= 0) return;

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - clamped);

    // El salto se detecta por flanco (al pulsar), no mientras está pulsado
    if (input.jump && !this.jumpPrev) this.jumpBuffer = PLAYER.JUMP_BUFFER;
    this.jumpPrev = input.jump;

    // Un frame se reparte en subpasos iguales de <= 1/120 s
    const n = Math.ceil(clamped / PLAYER.SUBSTEP);
    const h = clamped / n;
    for (let i = 0; i < n; i++) this.step(h, input);
  }

  /** Aplica daño con retroceso. Devuelve false si estaba en invulnerabilidad o muerto. */
  hurt(amount: number, dirX: number): boolean {
    if (this.invuln > 0 || this.health <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invuln = PLAYER.INVULN_TIME;
    this.vx = dirX * PLAYER.KNOCKBACK_X;
    this.vy = -PLAYER.KNOCKBACK_Y;
    this.onGround = false;
    this.jumping = false;
    return true;
  }

  /** ¿Está el punto (en píxeles del mundo) dentro del alcance del jugador? */
  canReachPoint(px: number, py: number): boolean {
    const dx = px - (this.x + this.width / 2);
    const dy = py - (this.y + this.height / 2);
    const r = PLAYER.REACH_BLOCKS * BLOCK_SIZE;
    return dx * dx + dy * dy <= r * r;
  }

  /** ¿Está el bloque (bx, by) dentro del alcance? (distancia entre centros) */
  canReach(bx: number, by: number): boolean {
    return this.canReachPoint((bx + 0.5) * BLOCK_SIZE, (by + 0.5) * BLOCK_SIZE);
  }

  private step(h: number, input: InputState): void {
    // Movimiento horizontal con aceleración
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const accel = this.onGround ? PLAYER.GROUND_ACCEL : PLAYER.AIR_ACCEL;
    this.vx = approach(this.vx, dir * PLAYER.MOVE_SPEED, accel * h);

    // Coyote time y buffer de salto
    this.coyote = this.onGround ? PLAYER.COYOTE_TIME : this.coyote - h;
    this.jumpBuffer -= h;

    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vy = -PLAYER.JUMP_SPEED;
      this.jumping = true;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.onGround = false;
    }

    // Altura de salto variable: soltar la tecla corta la subida
    if (this.jumping) {
      if (this.vy >= 0) this.jumping = false;
      else if (!input.jump) {
        this.vy *= PLAYER.JUMP_CUT;
        this.jumping = false;
      }
    }

    this.vy = Math.min(this.vy + PLAYER.GRAVITY * h, PLAYER.MAX_FALL);

    // Primero X, luego Y
    this.moveX(this.vx * h);
    this.moveY(this.vy * h);
  }
}