import { BLOCK_SIZE } from '../core/constants';
import { PixelMat } from '../pixels/materials';
import type { FluidSensor } from '../pixels/materials';
import type { WorldManager } from '../world/WorldManager';
import { PhysicsBody } from './PhysicsBody';
import { LIQUID, PLAYER } from './playerParams';

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
  /** El centro del cuerpo está en agua. */
  inWater = false;
  /** El cuerpo toca lava. */
  inLava = false;
  /** Sensor de agua y lava de la simulación de píxeles (null = sin fluidos). */
  fluids: FluidSensor | null = null;

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
    this.inWater = false;
    this.inLava = false;
  }

  update(dt: number, input: InputState): void {
    const clamped = Math.min(dt, PLAYER.MAX_DT);
    if (clamped <= 0) return;

    // Enterrado en arena (por ejemplo, tras reaparecer): sale por arriba
    if (this.sand !== null && this.overlapsSand(this.x, this.y)) this.escapeSolids();

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - clamped);
        
    // Agua y lava de píxeles: se miden una vez por frame sobre todo el cuerpo
    const f = this.fluids;
    this.inLava =
      f !== null && f.fraction(this.x, this.y, this.width, this.height, PixelMat.LAVA) > LIQUID.LAVA_TOUCH;
    this.inWater =
      !this.inLava &&
      f !== null &&
      f.fraction(this.x, this.y, this.width, this.height, PixelMat.WATER) > LIQUID.WATER_FRACTION;

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
    // Líquidos: el agua se detecta en el centro del cuerpo; la lava, con solo tocarla
    const inLiquid = this.inWater || this.inLava;
    const slow = this.inLava ? LIQUID.LAVA_SLOW : this.inWater ? LIQUID.WATER_SLOW : 1;

    // Movimiento horizontal con aceleración
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const accel = this.onGround ? PLAYER.GROUND_ACCEL : PLAYER.AIR_ACCEL;
    this.vx = approach(this.vx, dir * PLAYER.MOVE_SPEED * slow, accel * h);

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

    // Nadar: mantener el salto empuja hacia arriba
    if (inLiquid && input.jump) {
      const swimUp = this.inLava ? LIQUID.LAVA_SWIM_UP : LIQUID.SWIM_UP;
      this.vy = Math.max(this.vy - LIQUID.SWIM_ACCEL * h, -swimUp);
    }

    const gravity = inLiquid ? PLAYER.GRAVITY * LIQUID.GRAVITY_MULT : PLAYER.GRAVITY;
    const maxFall = inLiquid ? LIQUID.MAX_FALL : PLAYER.MAX_FALL;
    this.vy = Math.min(this.vy + gravity * h, maxFall);

    if (this.inLava) this.health = Math.max(0, this.health - LIQUID.LAVA_DPS * h);

    // Primero X, luego Y
    this.moveX(this.vx * h);
    this.moveY(this.vy * h);
  }
}