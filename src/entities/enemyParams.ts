import { SLIME } from './Enemy';

export interface EnemyParams {
  /** Si es false no aparecen enemigos nuevos (los que ya hay siguen). */
  spawnEnabled: boolean;
  maxEnemies: number;
  /** Segundos entre intentos de aparición. */
  spawnInterval: number;
  /** Distancia horizontal mínima y máxima (en bloques) a la que aparecen. */
  spawnMin: number;
  spawnMax: number;
  /** Distancia (en bloques) a la que empiezan a perseguir al jugador. */
  aggroRange: number;
  /** Distancia (en bloques) a partir de la cual desaparecen. */
  despawnX: number;
  despawnY: number;
  health: number;
  contactDamage: number;
}

export const DEFAULT_ENEMY_PARAMS: EnemyParams = {
  spawnEnabled: true,
  maxEnemies: 6,
  spawnInterval: 3,
  spawnMin: 40,
  spawnMax: 55,
  aggroRange: 30,
  despawnX: 70,
  despawnY: 50,
  health: SLIME.HEALTH,
  contactDamage: SLIME.DAMAGE,
};