import { isSolidBlock } from '../core/blockInfo';
import { BLOCK_SIZE } from '../core/constants';
import { blockToChunkCoord } from '../core/coords';
import type { SandSensor } from '../pixels/materials';
import type { WorldManager } from '../world/WorldManager';
import { PLAYER } from './playerParams';

const EPS = 0.001;
/** Resolución (px) con la que se busca la altura mínima de un escalón: el tamaño de una celda de píxel. */
const STEP_UNIT = 2;

/** Caja AABB que colisiona contra los bloques del mundo y, si tiene sensor, contra la arena. */
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
  /** Si no es null, la arena de la simulación de píxeles es sólida para este cuerpo. */
  sand: SandSensor | null = null;

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

  /** ¿Está la caja dentro de bloques sólidos o de arena? */
  isOverlapping(): boolean {
    return this.overlapsSolid(this.x, this.y);
  }

  /** Id del bloque en el centro de la caja. */
  protected centerBlock(): number {
    return this.world.getBlock(
      Math.floor((this.x + this.width / 2) / BLOCK_SIZE),
      Math.floor((this.y + this.height / 2) / BLOCK_SIZE),
    );
  }

  /** ¿Alguna celda que toca la caja contiene este bloque? */
  touchesBlock(id: number): boolean {
    const x0 = Math.floor(this.x / BLOCK_SIZE);
    const x1 = Math.floor((this.x + this.width - EPS) / BLOCK_SIZE);
    const y0 = Math.floor(this.y / BLOCK_SIZE);
    const y1 = Math.floor((this.y + this.height - EPS) / BLOCK_SIZE);
    for (let by = y0; by <= y1; by++) {
      for (let bx = x0; bx <= x1; bx++) {
        if (this.world.getBlock(bx, by) === id) return true;
      }
    }
    return false;
  }

  /** Un chunk sin cargar cuenta como sólido: nada cae al vacío. */
  protected isSolid(bx: number, by: number): boolean {
    if (!this.world.getChunk(blockToChunkCoord(bx), blockToChunkCoord(by))) return true;
    return isSolidBlock(this.world.getBlock(bx, by));
  }

  protected overlapsBlocks(x: number, y: number): boolean {
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

  protected overlapsSand(x: number, y: number): boolean {
    return this.sand !== null && this.sand.overlapsSand(x, y, this.width, this.height);
  }

  protected overlapsSolid(x: number, y: number): boolean {
    return this.overlapsBlocks(x, y) || this.overlapsSand(x, y);
  }

  /** Sube el cuerpo hasta salir de lo que lo rodea (por ejemplo, si queda enterrado en arena). Si no hay salida, no hace nada. */
  protected escapeSolids(maxLift = 96): void {
    for (let lift = STEP_UNIT; lift <= maxLift; lift += STEP_UNIT) {
      if (!this.overlapsSolid(this.x, this.y - lift)) {
        this.y -= lift;
        this.vy = 0;
        return;
      }
    }
  }

  /** Sube el cuerpo la altura MÍNIMA (hasta un bloque) que lo deja libre. false si no hay hueco. */
  private stepUp(): boolean {
    for (let lift = STEP_UNIT; lift <= BLOCK_SIZE; lift += STEP_UNIT) {
      if (!this.overlapsSolid(this.x, this.y - lift)) {
        this.y -= lift;
        return true;
      }
    }
    return false;
  }

  /** Bisección entre una posición válida (`prev`) y otra que choca (`hit`): devuelve la última válida. */
  private backOff(prev: number, hit: number, horizontal: boolean): number {
    let lo = prev;
    let hi = hit;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      const bad = horizontal ? this.overlapsSolid(mid, this.y) : this.overlapsSolid(this.x, mid);
      if (bad) hi = mid;
      else lo = mid;
    }
    return lo;
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
      const prev = this.x;
      this.x += s;
      if (!this.overlapsSolid(this.x, this.y)) continue;

      // Escalón: sube lo mínimo necesario (un bloque, o unos píxeles de arena)
      if (this.autoStep && this.onGround && this.stepUp()) continue;

      // Bloques: pegarse a la cara contra la que choca (exacto)
      if (this.overlapsBlocks(this.x, this.y)) {
        if (s > 0) {
          const col = Math.floor((this.x + this.width - EPS) / BLOCK_SIZE);
          this.x = col * BLOCK_SIZE - this.width;
        } else {
          const col = Math.floor(this.x / BLOCK_SIZE);
          this.x = (col + 1) * BLOCK_SIZE;
        }
      }
      // Arena: retroceder hasta el contacto
      if (this.overlapsSand(this.x, this.y)) this.x = this.backOff(prev, this.x, true);

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
      const prev = this.y;
      this.y += s;
      if (!this.overlapsSolid(this.x, this.y)) continue;

      if (this.overlapsBlocks(this.x, this.y)) {
        if (s > 0) {
          const row = Math.floor((this.y + this.height - EPS) / BLOCK_SIZE);
          this.y = row * BLOCK_SIZE - this.height;
        } else {
          const row = Math.floor(this.y / BLOCK_SIZE);
          this.y = (row + 1) * BLOCK_SIZE;
        }
      }
      if (this.overlapsSand(this.x, this.y)) this.y = this.backOff(prev, this.y, false);

      if (s > 0) this.onGround = true;
      this.vy = 0;
      return;
    }
  }
}