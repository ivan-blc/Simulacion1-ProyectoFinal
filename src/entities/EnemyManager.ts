import { isSolidBlock } from '../core/blockInfo';
import { BLOCK_SIZE } from '../core/constants';
import { PixelMat } from '../pixels/materials';
import type { FluidSensor } from '../pixels/materials';
import { LIQUID } from '../player/playerParams';
import { blockToChunkCoord, worldToBlockCoord } from '../core/coords';
import type { Player } from '../player/Player';
import type { WorldManager } from '../world/WorldManager';
import { Enemy, SLIME } from './Enemy';
import { DEFAULT_ENEMY_PARAMS } from './enemyParams';
import type { EnemyParams } from './enemyParams';

const SPAWN_SCAN = 14; // bloques arriba y abajo del jugador donde se busca suelo

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  /** Reglas de aparición y de los enemigos. Se pueden modificar en caliente. */
  readonly params: EnemyParams = { ...DEFAULT_ENEMY_PARAMS };
  onAdd?: (e: Enemy) => void;
  onRemove?: (e: Enemy) => void;
  
  /** Sensor de agua y lava de la simulación de píxeles. */
  fluids: FluidSensor | null = null;

  private spawnTimer = 2;
  private readonly world: WorldManager;

  constructor(world: WorldManager) {
    this.world = world;
  }

  update(dt: number, player: Player): void {
    const p = this.params;
    const pcx = player.x + player.width / 2;
    const pcy = player.y + player.height / 2;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = p.spawnInterval;
      if (p.spawnEnabled && this.enemies.length < p.maxEnemies) {
        this.trySpawn(pcx, pcy, p.spawnMin, p.spawnMax);
      }
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = pcx - e.cx;
      const dy = pcy - e.cy;

      if (Math.abs(dx) > p.despawnX * BLOCK_SIZE || Math.abs(dy) > p.despawnY * BLOCK_SIZE) {
        this.remove(e);
        continue;
      }

      const aggro = Math.abs(dx) < p.aggroRange * BLOCK_SIZE && Math.abs(dy) < p.aggroRange * BLOCK_SIZE;
      e.update(dt, pcx, aggro);

      // La lava quema a los enemigos
      if (this.fluids && this.fluids.fraction(e.x, e.y, e.width, e.height, PixelMat.LAVA) > 0.1) {
        e.health -= LIQUID.LAVA_DPS * dt;
        e.hurtTimer = 0.2;
        if (e.health <= 0) {
          this.remove(e);
          continue;
        }
      }

      // Daño por contacto (el retroceso empuja al jugador en sentido contrario al enemigo)
      const touching =
        e.x < player.x + player.width &&
        e.x + e.width > player.x &&
        e.y < player.y + player.height &&
        e.y + e.height > player.y;
      if (touching) player.hurt(p.contactDamage, dx >= 0 ? 1 : -1);
    }
  }

  remove(e: Enemy): void {
    const i = this.enemies.indexOf(e);
    if (i < 0) return;
    this.enemies.splice(i, 1);
    this.onRemove?.(e);
  }

  clear(): void {
    for (const e of [...this.enemies]) this.remove(e);
  }

  /** Genera un enemigo cerca del jugador, ignorando el límite y el temporizador (herramienta de desarrollo). */
  summon(pcx: number, pcy: number): boolean {
    for (let i = 0; i < 10; i++) {
      if (this.trySpawn(pcx, pcy, 6, 14)) return true;
    }
    return false;
  }

  /** Enemigo bajo el punto (px del mundo), con un margen opcional para facilitar el clic. */
  hitTest(wx: number, wy: number, margin = 0): Enemy | null {
    for (const e of this.enemies) {
      if (
        wx >= e.x - margin &&
        wx <= e.x + e.width + margin &&
        wy >= e.y - margin &&
        wy <= e.y + e.height + margin
      ) {
        return e;
      }
    }
    return null;
  }

  private loaded(bx: number, by: number): boolean {
    return this.world.getChunk(blockToChunkCoord(bx), blockToChunkCoord(by)) !== undefined;
  }

  /** Busca suelo en una columna a minDist..maxDist bloques: hueco libre con un bloque sólido debajo. */
  private trySpawn(pcx: number, pcy: number, minDist: number, maxDist: number): boolean {
    const pbx = worldToBlockCoord(pcx);
    const pby = worldToBlockCoord(pcy);
    const side = Math.random() < 0.5 ? -1 : 1;
    const span = Math.max(1, maxDist - minDist);
    const bx = pbx + side * (minDist + Math.floor(Math.random() * span));

    for (let by = pby - SPAWN_SCAN; by <= pby + SPAWN_SCAN; by++) {
      if (!this.loaded(bx, by) || !this.loaded(bx, by + 1)) continue;
      if (isSolidBlock(this.world.getBlock(bx, by))) continue;
      if (isSolidBlock(this.world.getBlock(bx, by - 1))) continue;
      if (!isSolidBlock(this.world.getBlock(bx, by + 1))) continue;

      const e = new Enemy(
        this.world,
        bx * BLOCK_SIZE + (BLOCK_SIZE - SLIME.WIDTH) / 2,
        (by + 1) * BLOCK_SIZE - SLIME.HEIGHT,
        this.params.health,
      );
      this.enemies.push(e);
      this.onAdd?.(e);
      return true;
    }
    return false;
  }
}