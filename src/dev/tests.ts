import { BlockId } from '../core/constants';
import {
  blockToChunkCoord,
  blockToLocalCoord,
  worldToBlock,
} from '../core/coords';
import { WorldManager } from '../world/WorldManager';

function check(name: string, cond: boolean) {
  console[cond ? 'log' : 'error'](`${cond ? '✔' : '✘'} ${name}`);
}

export function runPhase1Tests() {
  // Coordenadas, incluyendo negativos
  const wb = worldToBlock(-1, -1);
  check('worldToBlock(-1,-1) = (-1,-1)', wb.bx === -1 && wb.by === -1);
  check('chunk de bloque -1 es -1', blockToChunkCoord(-1) === -1);
  check('local de bloque -1 es 31', blockToLocalCoord(-1) === 31);
  check('bloque 32 -> chunk 1, local 0', blockToChunkCoord(32) === 1 && blockToLocalCoord(32) === 0);
  check('bloque -32 -> chunk -1, local 0', blockToChunkCoord(-32) === -1 && blockToLocalCoord(-32) === 0);
  check('bloque -33 -> chunk -2, local 31', blockToChunkCoord(-33) === -2 && blockToLocalCoord(-33) === 31);

  // set/get global
  const world = new WorldManager();
  world.setBlock(-5, 10, BlockId.DIRT);
  check('set/get con coordenada negativa', world.getBlock(-5, 10) === BlockId.DIRT);
  check('el chunk "-1,0" existe', world.getChunk(-1, 0) !== undefined);
  check('local correcto en chunk', world.getChunk(-1, 0)?.get(27, 10) === BlockId.DIRT);

  // Entre chunks distintos
  world.setBlock(31, 10, BlockId.STONE);
  world.setBlock(32, 10, BlockId.GRASS);
  check('bordes: 31 y 32 en chunks distintos',
    world.getBlock(31, 10) === BlockId.STONE &&
    world.getBlock(32, 10) === BlockId.GRASS &&
    world.getChunk(0, 0) !== world.getChunk(1, 0));

  // Dirty flag
  const c = world.getChunk(0, 0)!;
  c.isDirty = false;
  check('set sin cambio no ensucia', !world.setBlock(31, 10, BlockId.STONE) && !c.isDirty);
  check('set con cambio ensucia', world.setBlock(31, 10, BlockId.DIRT) && c.isDirty);

  // Carga y descarga por radio
  const w2 = new WorldManager();
  w2.update(0, 0, 2);
  check('radio 2 carga 5x5 = 25 chunks', w2.loadedCount === 25);
  w2.update(32 * 20, 0, 2);
  check('al alejarse se descargan los lejanos', w2.getChunk(0, 0) === undefined);
  check('tras moverse hay 25 chunks', w2.loadedCount === 25);
}