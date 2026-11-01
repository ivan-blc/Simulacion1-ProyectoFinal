import { BlockId, CHUNK_SIZE } from '../core/constants';
import {
  blockToChunkCoord,
  blockToLocalCoord,
  worldToBlock,
} from '../core/coords';
import { Chunk } from '../world/Chunk';
import { GEN } from '../world/genParams';
import { WorldGenerator } from '../world/WorldGenerator';
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

function sameArray(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function blockAt(world: WorldManager, bx: number, by: number): number {
  world.getOrCreateChunk(blockToChunkCoord(bx), blockToChunkCoord(by));
  return world.getBlock(bx, by);
}

export function runPhase2Tests() {
  const gen = new WorldGenerator(12345);
  const sameSeed = new WorldGenerator(12345);
  const otherSeed = new WorldGenerator(99999);

  // Determinismo
  const a = new Chunk(0, 6);
  const b = new Chunk(0, 6);
  const c = new Chunk(0, 6);
  gen.generateChunk(a);
  sameSeed.generateChunk(b);
  otherSeed.generateChunk(c);
  check('misma semilla -> mismo chunk', sameArray(a.blocks, b.blocks));
  check('otra semilla -> chunk distinto', !sameArray(a.blocks, c.blocks));

  // Superficie
  let inRange = true;
  let smooth = true;
  for (let bx = -2000; bx <= 2000; bx++) {
    const h = gen.surfaceHeight(bx);
    if (h < GEN.SURFACE_BASE - GEN.SURFACE_AMPLITUDE || h > GEN.SURFACE_BASE + GEN.SURFACE_AMPLITUDE) inRange = false;
    if (Math.abs(gen.surfaceHeight(bx + 1) - h) > 3) smooth = false;
  }
  check('altura dentro de base ± amplitud', inRange);
  check('superficie suave (salto <= 3 entre columnas)', smooth);

  // Capas en una columna
  const world = new WorldManager((ch) => gen.generateChunk(ch));
  const h10 = gen.surfaceHeight(10);
  check('bloque en la superficie es GRASS', blockAt(world, 10, h10) === BlockId.GRASS);
  check('bloque sobre la superficie es AIR', blockAt(world, 10, h10 - 1) === BlockId.AIR);
  check('bloque bajo el pasto es DIRT', blockAt(world, 10, h10 + 1) === BlockId.DIRT);
  const stoneDepth = GEN.DIRT_MIN + GEN.DIRT_VARIATION + 1;
  check('bajo la tierra hay STONE', blockAt(world, 10, h10 + stoneDepth) === BlockId.STONE);

  // Corteza sin cuevas
  let crustOk = true;
  for (let bx = -40; bx <= 40; bx++) {
    const h = gen.surfaceHeight(bx);
    for (let d = 0; d < GEN.CAVE_MIN_DEPTH; d++) {
      if (blockAt(world, bx, h + d) === BlockId.AIR) crustOk = false;
    }
  }
  check('sin cuevas cerca de la superficie', crustOk);

  // Costuras: el resultado con padding normal debe ser igual al de padding grande
  const sample: Array<[number, number]> = [[0, 2], [1, 2], [-1, 3], [-2, 5], [3, 6]];
  let seamsOk = true;
  let paddingMatters = false;
  for (const [cx, cy] of sample) {
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    const normal = gen.caveSolidRegion(x0, y0, CHUNK_SIZE, CHUNK_SIZE, GEN.CAVE_PAD);
    const big = gen.caveSolidRegion(x0, y0, CHUNK_SIZE, CHUNK_SIZE, 12);
    const none = gen.caveSolidRegion(x0, y0, CHUNK_SIZE, CHUNK_SIZE, 0);
    if (!sameArray(normal, big)) seamsOk = false;
    if (!sameArray(none, big)) paddingMatters = true;
  }
  check('padding 4 = padding 12 (sin costuras)', seamsOk);
  check('control: sin padding sí habría costuras', paddingMatters);

  // Hay cuevas a gran profundidad
  const deep = new Chunk(0, 8);
  gen.generateChunk(deep);
  let air = 0;
  for (let i = 0; i < deep.blocks.length; i++) if (deep.blocks[i] === BlockId.AIR) air++;
  const ratio = air / deep.blocks.length;
  check(`cuevas profundas con mezcla de aire y sólido (${(ratio * 100).toFixed(0)}% aire)`, ratio > 0.05 && ratio < 0.95);
}