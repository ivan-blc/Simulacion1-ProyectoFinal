import { BLOCK_SIZE, BlockId, CHUNK_SIZE } from '../core/constants';
import {
  blockToChunkCoord,
  blockToLocalCoord,
  worldToBlock,
} from '../core/coords';
import { Chunk } from '../world/Chunk';
import { GEN, ORES } from '../world/genParams';
import { WorldGenerator } from '../world/WorldGenerator';
import { WorldManager } from '../world/WorldManager';
import { Player } from '../player/Player';
import { colorToNumber, dropFor, isSolidBlock } from '../core/blockInfo';
import { Enemy, SLIME } from '../entities/Enemy';
import { EnemyManager } from '../entities/EnemyManager';
import { HOTBAR_SIZE, Inventory, MAX_STACK } from '../items/Inventory';
import { ObjectPool } from '../core/ObjectPool';
import { seedFromText } from '../core/random';
import type { ChunkProvider } from '../world/WorldManager';
import type { InputState } from '../player/Player';
import { TORCH_RECIPE, craftTorches } from '../items/crafting';
import { AMBIENT, LightField, ambientAtDepth } from '../lighting/LightField';
import { torchHasSupport } from '../world/torchRules';
import { DarknessMap, blurInPlace } from '../lighting/darkness';
import {
  CELLS,
  LAYER_COUNT,
  LayerBuffers,
  SAMPLE_N,
  buildSmoothLayers,
  caseArea,
  cellSkyMask,
  layerArea,
} from '../render/smoothing';



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

export function runPhase6Tests() {
  // Drops
  check('minar pasto suelta tierra', dropFor(BlockId.GRASS) === BlockId.DIRT);
  check('minar carbón suelta carbón', dropFor(BlockId.COAL) === BlockId.COAL);
  check('el aire no suelta nada', dropFor(BlockId.AIR) === null);

  // Inventario
  {
    const inv = new Inventory();
    check('inventario nuevo: nada seleccionado', inv.selectedItem() === null);
    check('add guarda en el primer slot', inv.add(BlockId.DIRT, 5) === 0 && inv.slots[0]?.count === 5);
    inv.add(BlockId.DIRT, 3);
    check('apila en el mismo slot', inv.slots[0]?.count === 8 && inv.slots[1] === null);
    inv.add(BlockId.STONE, 1);
    check('otro ítem usa otro slot', inv.slots[1]?.id === BlockId.STONE);
    check('consumeSelected resta 1', inv.consumeSelected() && inv.slots[0]?.count === 7);
    inv.select(1);
    check(
      'al agotar un stack, el slot queda vacío',
      inv.consumeSelected() && inv.slots[1] === null && !inv.consumeSelected(),
    );
  }
  {
    const inv = new Inventory();
    const left = inv.add(BlockId.DIRT, MAX_STACK * HOTBAR_SIZE + 5);
    check('add devuelve los sobrantes si no cabe', left === 5);
    check('inventario lleno no admite más', !inv.canAdd(BlockId.DIRT) && !inv.canAdd(BlockId.STONE));
  }
  {
    const a = new Inventory();
    a.add(BlockId.DIRT, 12);
    a.add(BlockId.COAL, 3);
    a.select(1);
    const b = new Inventory();
    check(
      'serializar y restaurar conserva el inventario',
      b.restore(a.serialize()) && b.selected === 1 && b.slots[0]?.count === 12 && b.slots[1]?.id === BlockId.COAL,
    );
    check('datos corruptos se rechazan sin romper nada', !b.restore('no es json') && b.slots[0]?.count === 12);
    const c = new Inventory();
    c.restore('{"slots":[[99,5],[1,0],null],"selected":50}');
    check('ids o cantidades inválidos se descartan', c.slots.every((s) => s === null) && c.selected === 0);
  }

  // Minerales
  const gen = new WorldGenerator(12345);
  const world = new WorldManager((ch) => gen.generateChunk(ch));
  const counts = new Map<number, number>();
  for (let cy = 5; cy <= 7; cy++) {
    for (let cx = -2; cx <= 2; cx++) {
      const ch = world.getOrCreateChunk(cx, cy);
      for (let i = 0; i < ch.blocks.length; i++) {
        counts.set(ch.blocks[i], (counts.get(ch.blocks[i]) ?? 0) + 1);
      }
    }
  }
  const coal = counts.get(BlockId.COAL) ?? 0;
  const iron = counts.get(BlockId.IRON) ?? 0;
  const gold = counts.get(BlockId.GOLD) ?? 0;
  check(`hay carbón en profundidad (${coal} bloques)`, coal > 0);
  check(`hay hierro en profundidad (${iron} bloques)`, iron > 0);
  check(`hay oro en profundidad (${gold} bloques)`, gold > 0);

  const minOre = Math.min(...ORES.map((o) => o.minDepth));
  let shallowOre = false;
  for (let bx = -60; bx <= 60; bx++) {
    const h = gen.surfaceHeight(bx);
    for (let d = 0; d < minOre; d++) {
      if (blockAt(world, bx, h + d) >= BlockId.COAL) shallowOre = true;
    }
  }
  check('sin minerales cerca de la superficie', !shallowOre);

  // Daño al jugador
  {
    const p = new Player(flatWorld());
    p.respawn(2, 40 * BLOCK_SIZE);
    run(p, 2, IDLE);
    const max = p.health;
    check('hurt resta vida y da retroceso', p.hurt(10, 1) && p.health === max - 10 && p.vx > 0 && p.vy < 0);
    check('invulnerable justo después de un golpe', !p.hurt(10, 1) && p.health === max - 10);
    run(p, 1.2, IDLE);
    check('pasada la invulnerabilidad vuelve a recibir daño', p.hurt(10, -1) && p.health === max - 20);
  }

  // Slime
  {
    const w = flatWorld();
    const e = new Enemy(w, 2 * BLOCK_SIZE, 40 * BLOCK_SIZE);
    for (let i = 0; i < 120; i++) e.update(1 / 60, 0, false);
    check(
      'el slime cae y aterriza sobre el suelo',
      e.onGround && Math.abs(e.y + e.height - 64 * BLOCK_SIZE) < 0.01,
    );

    const startX = e.x;
    for (let i = 0; i < 240; i++) e.update(1 / 60, 500, true);
    check('el slime salta hacia el jugador', e.x > startX + 20);

    const dead1 = e.damage(10, 1);
    check('un golpe no mata al slime', !dead1 && e.health === SLIME.HEALTH - 10 && e.vx > 0);
    check('el segundo golpe lo mata', e.damage(10, 1));
  }

  // Aparición de enemigos
  {
    const w = flatWorld();
    const p = landedPlayer(w);
    const mgr = new EnemyManager(w);
    let added = 0;
    mgr.onAdd = () => {
      added++;
    };
    mgr.update(2.1, p); // el temporizador inicial es de 2 s
    check('el manager genera un slime', mgr.enemies.length === 1 && added === 1);

    const e = mgr.enemies[0];
    const dist = Math.abs(e.cx - (p.x + p.width / 2)) / BLOCK_SIZE;
    check(`aparece lejos del jugador (${dist.toFixed(0)} bloques)`, dist >= 39 && dist <= 57);

    for (let i = 0; i < 60; i++) mgr.update(1 / 60, p);
    check(
      'el slime generado queda apoyado en el suelo',
      e.onGround && Math.abs(e.y + e.height - 64 * BLOCK_SIZE) < 0.01,
    );
    check('hitTest encuentra al slime', mgr.hitTest(e.cx, e.cy) === e);
    check('hitTest lejos devuelve null', mgr.hitTest(e.cx + 200, e.cy) === null);
  }
}

/** Comprobación en vivo: un chunk generado por el worker debe ser idéntico al del hilo principal. */
export function verifyWorkerChunk(
  gen: WorldGenerator,
  cx: number,
  cy: number,
  blocks: Uint8Array,
  ms: number,
): void {
  const ref = new Chunk(cx, cy);
  gen.generateChunk(ref);
  check(
    `worker: el chunk (${cx},${cy}) es idéntico al generado en el hilo principal (${ms.toFixed(1)} ms)`,
    sameArray(ref.blocks, blocks),
  );
}

class FakeProvider implements ChunkProvider {
  readonly requests: string[] = [];
  readonly cancelled: string[] = [];
  request(cx: number, cy: number): void {
    this.requests.push(`${cx},${cy}`);
  }
  cancel(cx: number, cy: number): void {
    this.cancelled.push(`${cx},${cy}`);
  }
}

export function runPhase7Tests() {
  // Pool de objetos (maxIdle = 2)
  {
    let made = 0;
    let destroyed = 0;
    const pool = new ObjectPool<{ id: number }>(
      () => ({ id: ++made }),
      () => {
        destroyed++;
      },
      2,
    );
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    check('el pool crea objetos cuando está vacío', made === 3 && pool.created === 3);
    pool.release(a);
    pool.release(b);
    pool.release(c);
    check('el pool destruye lo que supera maxIdle', destroyed === 1 && pool.idleCount === 2);
    const d = pool.acquire();
    check('el pool reutiliza objetos liberados', d === b && made === 3 && pool.reused === 1);
    pool.clear();
    check('clear destruye los objetos inactivos', destroyed === 2 && pool.idleCount === 0);
  }

  // Semillas desde texto
  check('seedFromText: un número se respeta', seedFromText('12345', 5) === 12345);
  check('seedFromText: vacío o null usa el valor por defecto', seedFromText('  ', 5) === 5 && seedFromText(null, 7) === 7);
  check(
    'seedFromText: el texto da un entero determinista y distinto por texto',
    Number.isInteger(seedFromText('hola', 0)) &&
      seedFromText('hola', 0) === seedFromText('hola', 0) &&
      seedFromText('hola', 0) !== seedFromText('chau', 0),
  );

  // Colores
  check('colorToNumber convierte #rrggbb y usa blanco si no entiende el formato', colorToNumber('#4caf50') === 0x4caf50 && colorToNumber('rgba(0,0,0,0)') === 0xffffff);

  // Modo asíncrono del WorldManager (con un provider falso)
  const fp = new FakeProvider();
  const w = new WorldManager();
  let loadedEvents = 0;
  w.onChunkLoaded = () => {
    loadedEvents++;
  };
  w.setProvider(fp);
  w.update(0, 0, 1);
  check(
    'modo asíncrono: update solo solicita chunks, no los genera',
    w.loadedCount === 0 && w.pendingCount === 9 && fp.requests.length === 9,
  );
  check('se solicita primero el chunk más cercano al jugador', fp.requests[0] === '0,0');
  w.update(0, 0, 1);
  check('un segundo update no repite solicitudes', fp.requests.length === 9);

  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  blocks[3] = BlockId.STONE;
  const edits = new Map<string, Array<[number, number]>>([['1,0', [[5, BlockId.DIRT]]]]);
  w.loadEdits(edits);

  check(
    'insertGenerated crea el chunk y avisa al render',
    w.insertGenerated(0, 0, blocks) && w.getChunk(0, 0) !== undefined && loadedEvents === 1 && w.pendingCount === 8,
  );
  check('el chunk insertado conserva los datos del worker', w.getBlock(3, 0) === BlockId.STONE);
  w.insertGenerated(1, 0, new Uint8Array(CHUNK_SIZE * CHUNK_SIZE));
  check('las ediciones guardadas se aplican a un chunk del worker', w.getBlock(CHUNK_SIZE + 5, 0) === BlockId.DIRT);
  check('un resultado que nadie pidió se descarta', !w.insertGenerated(9, 9, blocks) && w.getChunk(9, 9) === undefined);

  w.update(CHUNK_SIZE * 10, 0, 1);
  check(
    'al alejarse se cancelan las solicitudes lejanas y se descargan los chunks',
    fp.cancelled.length === 7 && w.pendingCount === 9 && w.loadedCount === 0,
  );
  check('un resultado tardío de un chunk cancelado se descarta', !w.insertGenerated(-1, -1, blocks));

  // Generación síncrona sobre un chunk pedido, y fallback sin provider
  const fp2 = new FakeProvider();
  const w2 = new WorldManager();
  w2.setProvider(fp2);
  w2.update(0, 0, 0);
  w2.getOrCreateChunk(0, 0);
  check(
    'crear un chunk de forma síncrona cancela su solicitud pendiente',
    w2.pendingCount === 0 && fp2.cancelled[0] === '0,0' && !w2.insertGenerated(0, 0, blocks) && w2.loadedCount === 1,
  );
  w2.setProvider(null);
  w2.update(CHUNK_SIZE * 5, 0, 1);
  check(
    'sin provider vuelve a generar de forma síncrona (fallback)',
    w2.loadedCount === 9 && w2.loadedInArea(5, 0, 1) === 9,
  );
}

export function runPhase8Tests() {
  const cellArea = BLOCK_SIZE * BLOCK_SIZE;
  const N = SAMPLE_N;
  const makeLayers = () => Array.from({ length: LAYER_COUNT }, () => new LayerBuffers(CELLS * CELLS));

  // Tabla de casos
  const expected = [0, 1 / 8, 1 / 8, 1 / 2, 1 / 8, 3 / 4, 1 / 2, 7 / 8, 1 / 8, 1 / 2, 3 / 4, 7 / 8, 1 / 2, 7 / 8, 7 / 8, 1];
  check(
    'marching squares: el área de cada uno de los 16 casos es la esperada',
    expected.every((a, m) => Math.abs(caseArea(m) - a) < 1e-9),
  );
  check(
    'marching squares: un caso y su complemento suman la celda entera (salvo las sillas 5 y 10)',
    [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14].every((m) => Math.abs(caseArea(m) + caseArea(15 - m) - 1) < 1e-9),
  );

  // Un bloque aislado se ve como un rombo de media celda de área
  {
    const ranks = new Uint8Array(N * N);
    ranks[10 * N + 10] = 2; // un bloque de tierra (rango 2)
    const layers = makeLayers();
    buildSmoothLayers(ranks, layers);
    check('bloque aislado: la capa 1 es un rombo de media celda', Math.abs(layerArea(layers[0]) - cellArea / 2) < 1e-6);
    check('bloque aislado: la capa 2 (su material) es el mismo rombo', Math.abs(layerArea(layers[1]) - cellArea / 2) < 1e-6);
    check('bloque aislado: no genera capas de rango superior', layers.slice(2).every((l) => l.indexCount === 0));
  }

  // Una superficie plana queda exactamente en el borde entre dos filas de bloques
  {
    const ranks = new Uint8Array(N * N);
    for (let sj = 20; sj < N; sj++) for (let si = 0; si < N; si++) ranks[sj * N + si] = 1;
    const layers = makeLayers();
    buildSmoothLayers(ranks, layers);
    const l = layers[0];
    let minY = Infinity;
    for (let v = 0; v < l.vertexCount; v++) minY = Math.min(minY, l.positions[v * 2 + 1]);
    const expectedArea = CELLS * BLOCK_SIZE * (CELLS - 19.5) * BLOCK_SIZE;
    check('superficie plana: el área sólida es la esperada', Math.abs(layerArea(l) - expectedArea) < 1e-6);
    check('superficie plana: queda exactamente en el borde entre bloques', minY === 19 * BLOCK_SIZE);
  }

  // Fondo por celdas
  {
    const samples = new Uint8Array(N * N);
    for (let sj = 20; sj < N; sj++) for (let si = 0; si < N; si++) samples[sj * N + si] = BlockId.STONE;
    const heights = new Array<number>(N).fill(10);
    const mask = cellSkyMask(samples, heights, 0);
    check('fondo: el aire sobre la superficie es cielo', mask[5 * CELLS + 5] === 1);
    check('fondo: el aire bajo la superficie es cueva', mask[15 * CELLS + 5] === 0);
  }

  // Hook de cambio de bloque (usado para marcar los chunks vecinos)
  {
    const w = new WorldManager();
    const calls: string[] = [];
    w.onBlockChanged = (bx, by) => {
      calls.push(`${bx},${by}`);
    };
    w.setBlock(5, 70, BlockId.AIR); // en el mundo plano por defecto, by 70 es piedra
    check('onBlockChanged avisa del cambio con sus coordenadas', calls.length === 1 && calls[0] === '5,70');
    w.setBlock(5, 70, BlockId.AIR);
    check('onBlockChanged no avisa si el bloque no cambió', calls.length === 1);
  }
}

export function runPhase9Tests() {
  // Bloques
  check(
    'antorcha: no es sólida; tierra y piedra sí; aire no',
    !isSolidBlock(BlockId.TORCH) && isSolidBlock(BlockId.DIRT) && isSolidBlock(BlockId.STONE) && !isSolidBlock(BlockId.AIR),
  );
  check('minar una antorcha suelta una antorcha', dropFor(BlockId.TORCH) === BlockId.TORCH);

  // Física: se atraviesa
  {
    const w = flatWorld();
    w.setBlock(10, 63, BlockId.TORCH);
    const p = landedPlayer(w);
    run(p, 3, RIGHT);
    check('el jugador atraviesa una antorcha', p.x > 12 * BLOCK_SIZE && p.onGround);
  }

  // Apoyo
  {
    const w = flatWorld();
    const get = (x: number, y: number) => w.getBlock(x, y);
    check('apoyo: sobre el suelo sí', torchHasSupport(get, 5, 63));
    check('apoyo: en el aire no', !torchHasSupport(get, 5, 55));
    w.setBlock(6, 55, BlockId.STONE);
    check('apoyo: junto a una pared sí', torchHasSupport(get, 5, 55));
    w.setBlock(20, 56, BlockId.TORCH);
    check('apoyo: otra antorcha no sirve de apoyo', !torchHasSupport(get, 20, 55));
  }

  // Inventario y fabricación
  {
    const inv = new Inventory();
    inv.add(BlockId.COAL, 3);
    check(
      'fabricar: 1 carbón da 4 antorchas',
      craftTorches(inv) === 'ok' && inv.count(BlockId.COAL) === 2 && inv.count(BlockId.TORCH) === TORCH_RECIPE.torches,
    );
    check('fabricar: sin carbón no hace nada', craftTorches(new Inventory()) === 'no-coal');

    const full = new Inventory();
    full.add(BlockId.COAL, 1);
    full.add(BlockId.DIRT, MAX_STACK * (HOTBAR_SIZE - 1));
    check('fabricar: con el inventario lleno no gasta el carbón', craftTorches(full) === 'full' && full.count(BlockId.COAL) === 1);

    const r = new Inventory();
    r.add(BlockId.DIRT, 5);
    check(
      'Inventory.remove quita unidades y rechaza si no hay suficientes',
      r.remove(BlockId.DIRT, 3) && r.count(BlockId.DIRT) === 2 && !r.remove(BlockId.DIRT, 9) && r.count(BlockId.DIRT) === 2,
    );
  }

  // Campo de luz: rejilla x 0..23, y 45..62 (aire sobre el suelo plano en by = 64)
  const setup = (w: WorldManager) => {
    const f = new LightField(12);
    f.begin(0, 45, 24, 18);
    f.scan((cx, cy) => w.getChunk(cx, cy));
    return f;
  };

  // Campo abierto
  const wOpen = flatWorld();
  {
    const f = setup(wOpen);
    f.addLight(10.5, 55.5, 8, 1);
    const center = f.brightnessAt(10, 55);
    const near = f.brightnessAt(12, 55);
    const far = f.brightnessAt(16, 55);
    check(
      `luz abierta: máxima en la fuente (${center.toFixed(2)}), decrece con la distancia y se anula fuera del radio`,
      center > 0.99 && near > far && far > 0 && f.brightnessAt(19, 55) === 0,
    );
  }

  // Un muro bloquea la luz
  {
    const w = flatWorld();
    for (let by = 45; by < 64; by++) w.setBlock(14, by, BlockId.STONE);
    const f = setup(w);
    f.addLight(10.5, 55.5, 8, 1);
    check(
      'un muro bloquea la luz: se ilumina su cara, no lo que hay detrás',
      f.brightnessAt(13, 55) > 0.3 && f.brightnessAt(14, 55) > 0 && f.brightnessAt(15, 55) === 0 && f.brightnessAt(16, 56) === 0,
    );
  }

  // Un enemigo proyecta una sombra parcial
  {
    const f1 = setup(wOpen);
    f1.addLight(10.5, 55.5, 8, 1);
    const free = f1.brightnessAt(14, 55);

    const f2 = setup(wOpen);
    f2.stampRect(12.1, 55.1, 12.9, 55.9, 0.6); // ocupa solo la celda (12, 55)
    f2.addLight(10.5, 55.5, 8, 1);
    const shadow = f2.brightnessAt(14, 55);
    check(
      'un enemigo proyecta una sombra parcial (deja pasar el 40 %)',
      Math.abs(shadow - free * 0.4) < 0.01 && shadow > 0 && shadow < free,
    );
  }

  // Varias luces
  {
    const f1 = setup(wOpen);
    f1.addLight(8.5, 55.5, 8, 0.8);
    const one = f1.brightnessAt(11, 55);
    const f2 = setup(wOpen);
    f2.addLight(8.5, 55.5, 8, 0.8);
    f2.addLight(13.5, 55.5, 8, 0.8);
    const both = f2.brightnessAt(11, 55);
    check('dos luces suman sin pasar de 1', both > one && both <= 1);
  }

  // Antorchas como fuentes
  {
    const w = flatWorld();
    w.setBlock(10, 55, BlockId.TORCH);
    const f = setup(w);
    f.addBlockLights(0);
    check(
      'scan encuentra las antorchas y addBlockLights las ilumina',
      f.lightsCast === 1 && f.brightnessAt(10, 55) > 0.9 && f.brightnessAt(10, 55) <= 1,
    );
  }

  // Chunks sin cargar
  {
    const f = new LightField(12);
    f.begin(0, 45, 24, 18);
    f.scan(() => undefined);
    f.addLight(10.5, 55.5, 8, 1);
    check('una zona sin cargar bloquea la luz', f.brightnessAt(11, 55) > 0 && f.brightnessAt(12, 55) === 0);
  }

  // Oscuridad ambiental
  check(
    'oscuridad ambiental: nula en superficie, creciente con la profundidad y acotada',
    ambientAtDepth(-5) === 0 &&
      ambientAtDepth(AMBIENT.START) === 0 &&
      ambientAtDepth(20) > 0 &&
      ambientAtDepth(200) === AMBIENT.MAX,
  );
}

export function runPhase10Tests() {
  const setupScale = (w: WorldManager, scale: number) => {
    const f = new LightField(12, scale);
    f.begin(0, 45, 24, 18);
    f.scan((cx, cy) => w.getChunk(cx, cy));
    return f;
  };
  const world = flatWorld();

  // Rejilla de muestras
  {
    const f = setupScale(world, 2);
    check(
      'supersampling x2: la rejilla de muestras tiene el doble en cada eje',
      f.sw === 48 && f.sh === 36 && f.unlit.length === 48 * 36,
    );
  }

  // Campo abierto con supersampling
  {
    const f = setupScale(world, 2);
    f.addLight(10.5, 55.5, 8, 1);
    const center = f.brightnessAt(10, 55);
    check(
      `supersampling x2: luz máxima en la fuente (${center.toFixed(2)}), decreciente y nula fuera del radio`,
      center > 0.98 && f.brightnessAt(12, 55) > f.brightnessAt(16, 55) && f.brightnessAt(16, 55) > 0 && f.brightnessAt(19, 55) === 0,
    );
  }

  // Penumbra: un bloque suelto da sombra parcial solo con supersampling
  {
    const blocked = flatWorld();
    blocked.setBlock(13, 55, BlockId.STONE);
    const hasPartialShadow = (scale: number): boolean => {
      const free = setupScale(world, scale);
      free.addLight(10.5, 55.5, 8, 1);
      const blk = setupScale(blocked, scale);
      blk.addLight(10.5, 55.5, 8, 1);
      for (let y = 52; y <= 58; y++) {
        for (let x = 14; x <= 19; x++) {
          const a = free.brightnessAt(x, y);
          if (a < 0.02) continue;
          const ratio = blk.brightnessAt(x, y) / a;
          if (ratio > 0.1 && ratio < 0.9) return true;
        }
      }
      return false;
    };
    check('sin supersampling las sombras son todo o nada', !hasPartialShadow(1));
    check('con supersampling x2 aparece una penumbra (sombras parciales)', hasPartialShadow(2));
  }

  // Desenfoque
  {
    const c = new Float32Array(16 * 8).fill(0.5);
    blurInPlace(c, new Float32Array(16 * 8), 16, 8, 3);
    check('blur: un campo constante no cambia', c.every((v) => Math.abs(v - 0.5) < 1e-6));

    const spike = Float32Array.from([0, 0, 1, 0, 0]);
    blurInPlace(spike, new Float32Array(5), 5, 1, 1);
    check(
      'blur: un pico se reparte como [0, ¼, ½, ¼, 0]',
      [0, 0.25, 0.5, 0.25, 0].every((v, i) => Math.abs(spike[i] - v) < 1e-6),
    );

    const keep = Float32Array.from([0, 1, 0, 1]);
    blurInPlace(keep, new Float32Array(4), 4, 1, 0);
    check('blur: con 0 pasadas no toca nada', keep[0] === 0 && keep[1] === 1 && keep[2] === 0 && keep[3] === 1);

    const w = 16;
    const h = 8;
    const edge = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) edge[j * w + i] = i < 8 ? 1 : 0;
    blurInPlace(edge, new Float32Array(w * h), w, h, 2);
    let maxStep = 0;
    let inRange = true;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = edge[j * w + i];
        if (v < 0 || v > 1) inRange = false;
        if (i < w - 1) maxStep = Math.max(maxStep, Math.abs(edge[j * w + i + 1] - v));
      }
    }
    check(
      `blur: un borde duro se reparte en varios escalones (salto máximo ${maxStep.toFixed(2)}) sin salirse de rango`,
      maxStep < 0.5 && inRange,
    );
  }

  // Mapa de oscuridad
  {
    const f = setupScale(world, 2);
    f.addLight(10.5, 55.5, 8, 1);
    const map = new DarknessMap();

    map.update(f, new Array<number>(24).fill(0), 0); // superficie en y = 0: todo está muy profundo
    check(
      'oscuridad: casi nula junto a la luz y máxima lejos de ella',
      map.data[21 * 48 + 21] < 0.05 && Math.abs(map.data[1 * 48 + 46] - AMBIENT.MAX) < 1e-6,
    );

    map.update(f, new Array<number>(24).fill(70), 2); // superficie bajo la rejilla: todo es cielo
    check('oscuridad: nula sobre la superficie, incluso con el suavizado', map.data.every((v) => v === 0));
  }
}