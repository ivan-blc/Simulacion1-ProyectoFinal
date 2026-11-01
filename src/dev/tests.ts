import { BLOCK_SIZE, BlockId, CHUNK_SIZE } from '../core/constants';
import {
  blockToChunkCoord,
  blockToLocalCoord,
  worldToBlock,
} from '../core/coords';
import { Chunk } from '../world/Chunk';
import { GEN } from '../world/genParams';
import { WorldGenerator } from '../world/WorldGenerator';
import { WorldManager } from '../world/WorldManager';
import { Player } from '../player/Player';
import type { InputState } from '../player/Player';

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

export function runPhase4Tests() {
  const gen = new WorldGenerator(12345);
  const mk = () => new WorldManager((ch) => gen.generateChunk(ch));

  const w = mk();
  const bx = 10;
  const by = gen.surfaceHeight(bx);
  const pcy = blockToChunkCoord(by);
  w.getOrCreateChunk(0, pcy);

  check('antes de minar, la superficie es GRASS', w.getBlock(bx, by) === BlockId.GRASS);
  check('minar devuelve true', w.setBlock(bx, by, BlockId.AIR));
  check('minar aire devuelve false', !w.setBlock(bx, by, BlockId.AIR));

  // Alejarse descarga el chunk; volver debe conservar la edición
  w.update(bx + 32 * 50, by, 1);
  check('el chunk se descarga al alejarse', w.getChunk(0, pcy) === undefined);
  w.update(bx, by, 1);
  check('la edición sobrevive a descargar y recargar', w.getBlock(bx, by) === BlockId.AIR);

  // Ida y vuelta de persistencia (sin IndexedDB)
  const saved = w.takeModified();
  check('takeModified devuelve el chunk editado', saved.length === 1 && saved[0][0] === `0,${pcy}`);
  check('takeModified vacía la cola', w.takeModified().length === 0);

  const w2 = mk();
  w2.loadEdits(new Map(saved));
  const c2 = w2.getOrCreateChunk(0, pcy);
  check('la edición se restaura en un mundo nuevo', w2.getBlock(bx, by) === BlockId.AIR);

  const fresh = new Chunk(0, pcy);
  gen.generateChunk(fresh);
  let diffs = 0;
  for (let i = 0; i < fresh.blocks.length; i++) if (fresh.blocks[i] !== c2.blocks[i]) diffs++;
  check('solo 1 bloque difiere de la generación original', diffs === 1);
}

const IDLE: InputState = { left: false, right: false, jump: false };
const RIGHT: InputState = { left: false, right: true, jump: false };
const JUMP: InputState = { left: false, right: false, jump: true };

function run(p: Player, seconds: number, input: InputState): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) p.update(1 / 60, input);
}

/** Mundo con el generador plano por defecto: suelo sólido desde by = 64. */
function flatWorld(): WorldManager {
  const w = new WorldManager();
  w.update(0, 64, 2);
  return w;
}

function landedPlayer(w: WorldManager): Player {
  const p = new Player(w);
  p.respawn(2, 60 * BLOCK_SIZE);
  run(p, 1, IDLE);
  return p;
}

export function runPhase5Tests() {
  const GROUND = 64 * BLOCK_SIZE;

  // Aterrizaje
  {
    const p = new Player(flatWorld());
    p.respawn(2, 40 * BLOCK_SIZE);
    run(p, 2, IDLE);
    check('cae y aterriza exactamente sobre el suelo', Math.abs(p.y + p.height - GROUND) < 0.01);
    check('onGround es true al aterrizar', p.onGround);
  }

  // Muro alto: se detiene pegado a la pared
  {
    const w = flatWorld();
    for (let by = 56; by < 64; by++) w.setBlock(10, by, BlockId.STONE);
    const p = landedPlayer(w);
    run(p, 3, RIGHT);
    check(
      'se detiene contra un muro de 8 bloques',
      Math.abs(p.x + p.width - 10 * BLOCK_SIZE) < 0.01 && p.vx === 0,
    );
  }

  // Escalón de 1 bloque: sube solo
  {
    const w = flatWorld();
    for (let bx = 10; bx <= 40; bx++) w.setBlock(bx, 63, BlockId.STONE);
    const p = landedPlayer(w);
    run(p, 2, RIGHT);
    check(
      'sube sola un escalón de 1 bloque',
      p.onGround && Math.abs(p.y + p.height - 63 * BLOCK_SIZE) < 0.01 && p.x > 10 * BLOCK_SIZE,
    );
  }

  // Muro de 2 bloques: no lo sube sola
  {
    const w = flatWorld();
    w.setBlock(10, 62, BlockId.STONE);
    w.setBlock(10, 63, BlockId.STONE);
    const p = landedPlayer(w);
    run(p, 3, RIGHT);
    check(
      'no sube sola un muro de 2 bloques',
      Math.abs(p.x + p.width - 10 * BLOCK_SIZE) < 0.01 && Math.abs(p.y + p.height - GROUND) < 0.01,
    );
  }

    // Techo: el salto choca con un bloque encima
  {
    const w = flatWorld();
    const p = landedPlayer(w);       // primero aterriza (y = 996)
    w.setBlock(0, 60, BlockId.STONE); // luego aparece el techo: su cara inferior queda en y = 976
    const groundY = p.y;
    let minY = p.y;
    for (let i = 0; i < 60; i++) {
      p.update(1 / 60, JUMP);
      minY = Math.min(minY, p.y);
    }
    check(
      'el techo bloquea el salto',
      minY >= 61 * BLOCK_SIZE - 0.01 && groundY - minY > 5,
    );
  }

  // Altura del salto sin obstáculos
  {
    const p = landedPlayer(flatWorld());
    const groundY = p.y;
    let minY = p.y;
    for (let i = 0; i < 60; i++) {
      p.update(1 / 60, JUMP);
      minY = Math.min(minY, p.y);
    }
    const rise = groundY - minY;
    check(
      `altura de salto entre 4 y 6 bloques (${(rise / BLOCK_SIZE).toFixed(1)})`,
      rise > 4 * BLOCK_SIZE && rise < 6 * BLOCK_SIZE,
    );
  }

  // dt enorme (pestaña en segundo plano): no atraviesa el suelo
  {
    const p = new Player(flatWorld());
    p.respawn(2, 50 * BLOCK_SIZE);
    let maxBottom = 0;
    for (let i = 0; i < 20; i++) {
      p.update(0.25, IDLE);
      maxBottom = Math.max(maxBottom, p.y + p.height);
    }
    check('un dt enorme no atraviesa el suelo', maxBottom <= GROUND + 0.01 && p.onGround);
  }

  // Un chunk sin cargar actúa como sólido
  {
    const w = new WorldManager();
    w.getOrCreateChunk(0, 0); // aire, by 0..31; el chunk (0,1) NO está cargado
    const p = new Player(w);
    p.respawn(2, 0);
    run(p, 2, IDLE);
    check(
      'un chunk sin cargar actúa como sólido',
      p.onGround && Math.abs(p.y + p.height - 32 * BLOCK_SIZE) < 0.01,
    );
  }

  // Alcance y solapamiento (jugador en y = 0..28, x = 0..12)
  {
    const p = new Player(flatWorld());
    p.respawn(0, 0);
    check('alcance: bloque cercano', p.canReach(0, 1));
    check('alcance: bloque lejano', !p.canReach(30, 0));
    check('solapamiento: bloque dentro del jugador', p.overlapsBlock(0, 1));
    check('solapamiento: bloque bajo los pies no solapa', !p.overlapsBlock(0, 2));
  }
}