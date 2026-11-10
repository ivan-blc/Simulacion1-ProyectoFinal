import { isSolidBlock } from '../core/blockInfo';
import { BLOCK_SIZE } from '../core/constants';
import { blockToChunkCoord, worldToBlockCoord } from '../core/coords';
import type { Player } from '../player/Player';
import type { WorldManager } from '../world/WorldManager';
import { Enemy, SLIME } from './Enemy';

const SPAWN_MIN = 40;        // bloques de distancia horizontal mínima al aparecer
const SPAWN_MAX = 55;
const SPAWN_SCAN = 14;       // bloques arriba y abajo del jugador donde se busca suelo
const SPAWN_INTERVAL = 3;    // s entre intentos de aparición
const AGGRO = 30;            // bloques: a esta distancia empiezan a perseguir
const DESPAWN_X = 70;        // bloques: más allá desaparecen
const DESPAWN_Y = 50;

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  maxEnemies = 6;
  onAdd?: (e: Enemy) => void;
  onRemove?: (e: Enemy) => void;

  private spawnTimer = 2;
  private readonly world: WorldManager;

  constructor(world: WorldManager) {
    this.world = world;
  }

  update(dt: number, player: Player): void {
    const pcx = player.x + player.width / 2;
    const pcy = player.y + player.height / 2;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      if (this.enemies.length < this.maxEnemies) this.trySpawn(pcx, pcy);
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = pcx - e.cx;
      const dy = pcy - e.cy;

      if (Math.abs(dx) > DESPAWN_X * BLOCK_SIZE || Math.abs(dy) > DESPAWN_Y * BLOCK_SIZE) {
        this.remove(e);
        continue;
      }

      const aggro = Math.abs(dx) < AGGRO * BLOCK_SIZE && Math.abs(dy) < AGGRO * BLOCK_SIZE;
      e.update(dt, pcx, aggro);

      // Daño por contacto (el retroceso empuja al jugador en sentido contrario al enemigo)
      const touching =
        e.x < player.x + player.width &&
        e.x + e.width > player.x &&
        e.y < player.y + player.height &&
        e.y + e.height > player.y;
      if (touching) player.hurt(SLIME.DAMAGE, dx >= 0 ? 1 : -1);
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

  /** Busca suelo en una columna lejana: hueco libre con un bloque sólido debajo. */
  private trySpawn(pcx: number, pcy: number): void {
    const pbx = worldToBlockCoord(pcx);
    const pby = worldToBlockCoord(pcy);
    const side = Math.random() < 0.5 ? -1 : 1;
    const bx = pbx + side * (SPAWN_MIN + Math.floor(Math.random() * (SPAWN_MAX - SPAWN_MIN)));

    for (let by = pby - SPAWN_SCAN; by <= pby + SPAWN_SCAN; by++) {
      if (!this.loaded(bx, by) || !this.loaded(bx, by + 1)) continue;
      if (isSolidBlock(this.world.getBlock(bx, by))) continue;
      if (isSolidBlock(this.world.getBlock(bx, by - 1))) continue;
      if (!isSolidBlock(this.world.getBlock(bx, by + 1))) continue;

      const e = new Enemy(
        this.world,
        bx * BLOCK_SIZE + (BLOCK_SIZE - SLIME.WIDTH) / 2,
        (by + 1) * BLOCK_SIZE - SLIME.HEIGHT,
      );
      this.enemies.push(e);
      this.onAdd?.(e);
      return;
    }
  }
}