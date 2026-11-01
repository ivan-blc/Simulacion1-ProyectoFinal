import { BLOCK_SIZE, BlockId } from '../core/constants';
import { blockToChunkCoord } from '../core/coords';
import type { WorldManager } from '../world/WorldManager';
import { PLAYER } from './playerParams';

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
}

const EPS = 0.001;

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

export class Player {
  /** Esquina superior izquierda de la caja, en píxeles del mundo. */
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  onGround = false;
  readonly width: number = PLAYER.WIDTH;
  readonly height: number = PLAYER.HEIGHT;

  private readonly world: WorldManager;
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpPrev = false;
  private jumping = false;

  constructor(world: WorldManager) {
    this.world = world;
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
  }

  update(dt: number, input: InputState): void {
    const clamped = Math.min(dt, PLAYER.MAX_DT);
    if (clamped <= 0) return;

    // El salto se detecta por flanco (al pulsar), no mientras está pulsado
    if (input.jump && !this.jumpPrev) this.jumpBuffer = PLAYER.JUMP_BUFFER;
    this.jumpPrev = input.jump;

    // Un frame se reparte en subpasos iguales de <= 1/120 s: la física es casi
    // independiente de los FPS y no hay saltos visibles
    const n = Math.ceil(clamped / PLAYER.SUBSTEP);
    const h = clamped / n;
    for (let i = 0; i < n; i++) this.step(h, input);
  }

  /** ¿Está el bloque (bx, by) dentro del alcance del jugador? (distancia entre centros) */
  canReach(bx: number, by: number): boolean {
    const dx = (bx + 0.5) * BLOCK_SIZE - (this.x + this.width / 2);
    const dy = (by + 0.5) * BLOCK_SIZE - (this.y + this.height / 2);
    const r = PLAYER.REACH_BLOCKS * BLOCK_SIZE;
    return dx * dx + dy * dy <= r * r;
  }

  /** ¿Solapa el bloque (bx, by) con la caja del jugador? Rozar el borde no cuenta. */
  overlapsBlock(bx: number, by: number): boolean {
    return (
      bx * BLOCK_SIZE < this.x + this.width &&
      (bx + 1) * BLOCK_SIZE > this.x &&
      by * BLOCK_SIZE < this.y + this.height &&
      (by + 1) * BLOCK_SIZE > this.y
    );
  }

  /** ¿Está la caja dentro de bloques sólidos? Útil para comprobar el punto de aparición. */
  isOverlapping(): boolean {
    return this.overlapsSolid(this.x, this.y);
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

    // Primero X, luego Y: cada eje se resuelve por separado
    this.moveX(this.vx * h);
    this.moveY(this.vy * h);
  }

  /** Un chunk sin cargar cuenta como sólido: el jugador nunca cae al vacío. */
  private isSolid(bx: number, by: number): boolean {
    if (!this.world.getChunk(blockToChunkCoord(bx), blockToChunkCoord(by))) return true;
    return this.world.getBlock(bx, by) !== BlockId.AIR;
  }

  private overlapsSolid(x: number, y: number): boolean {
    const x0 = Math.floor(x / BLOCK_SIZE);
    const x1 = Math.floor((x + this.width - EPS) / BLOCK_SIZE);
    const y0 = Math.floor(y / BLOCK_SIZE);
    const y1 = Math.floor((y + this.height - EPS) / BLOCK_SIZE);
    for (let by = y0; by <= y1; by++) {
      for (let bx = x0; bx <= x1; bx++) {
        if (this.isSolid(bx, by)) return true;
      }
    }
    return false;
  }

  private moveX(dx: number): void {
    let remaining = dx;
    while (remaining !== 0) {
      const s =
        Math.abs(remaining) > PLAYER.MAX_STEP_PX
          ? Math.sign(remaining) * PLAYER.MAX_STEP_PX
          : remaining;
      remaining -= s;
      this.x += s;
      if (!this.overlapsSolid(this.x, this.y)) continue;

      // Escalón de 1 bloque: si hay hueco para subir, sube sin saltar
      if (PLAYER.AUTO_STEP && this.onGround && !this.overlapsSolid(this.x, this.y - BLOCK_SIZE)) {
        this.y -= BLOCK_SIZE;
        continue;
      }

      // Pegarse a la cara del bloque contra el que choca
      if (s > 0) {
        const col = Math.floor((this.x + this.width - EPS) / BLOCK_SIZE);
        this.x = col * BLOCK_SIZE - this.width;
      } else {
        const col = Math.floor(this.x / BLOCK_SIZE);
        this.x = (col + 1) * BLOCK_SIZE;
      }
      this.vx = 0;
      return;
    }
  }

  private moveY(dy: number): void {
    this.onGround = false;
    let remaining = dy;
    while (remaining !== 0) {
      const s =
        Math.abs(remaining) > PLAYER.MAX_STEP_PX
          ? Math.sign(remaining) * PLAYER.MAX_STEP_PX
          : remaining;
      remaining -= s;
      this.y += s;
      if (!this.overlapsSolid(this.x, this.y)) continue;

      if (s > 0) {
        const row = Math.floor((this.y + this.height - EPS) / BLOCK_SIZE);
        this.y = row * BLOCK_SIZE - this.height;
        this.onGround = true;
      } else {
        const row = Math.floor(this.y / BLOCK_SIZE);
        this.y = (row + 1) * BLOCK_SIZE;
      }
      this.vy = 0;
      return;
    }
  }
}