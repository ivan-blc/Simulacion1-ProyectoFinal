import { BLOCK_SIZE, BlockId } from '../core/constants';
import { blockToChunkCoord } from '../core/coords';
import type { WorldManager } from '../world/WorldManager';
import { PLAYER } from './playerParams';

const EPS = 0.001;

/** Caja AABB que colisiona contra los bloques del mundo. La usan el jugador y los enemigos. */
export class PhysicsBody {
  /** Esquina superior izquierda, en píxeles del mundo. */
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  onGround = false;
  /** true si el último moveX chocó contra una pared. */
  blockedX = false;
  readonly width: number;
  readonly height: number;

  protected readonly world: WorldManager;
  private readonly autoStep: boolean;

  constructor(world: WorldManager, width: number, height: number, autoStep: boolean) {
    this.world = world;
    this.width = width;
    this.height = height;
    this.autoStep = autoStep;
  }

  /** ¿Solapa el bloque (bx, by) con la caja? Rozar el borde no cuenta. */
  overlapsBlock(bx: number, by: number): boolean {
    return (
      bx * BLOCK_SIZE < this.x + this.width &&
      (bx + 1) * BLOCK_SIZE > this.x &&
      by * BLOCK_SIZE < this.y + this.height &&
      (by + 1) * BLOCK_SIZE > this.y
    );
  }

  /** ¿Está la caja dentro de bloques sólidos? */
  isOverlapping(): boolean {
    return this.overlapsSolid(this.x, this.y);
  }

  /** Un chunk sin cargar cuenta como sólido: nada cae al vacío. */
  protected isSolid(bx: number, by: number): boolean {
    if (!this.world.getChunk(blockToChunkCoord(bx), blockToChunkCoord(by))) return true;
    return this.world.getBlock(bx, by) !== BlockId.AIR;
  }

  protected overlapsSolid(x: number, y: number): boolean {
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

  protected moveX(dx: number): void {
    this.blockedX = false;
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
      if (this.autoStep && this.onGround && !this.overlapsSolid(this.x, this.y - BLOCK_SIZE)) {
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
      this.blockedX = true;
      return;
    }
  }

  protected moveY(dy: number): void {
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