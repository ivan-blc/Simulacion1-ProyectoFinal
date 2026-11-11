import { Application, Container, Graphics } from 'pixi.js';
import { AudioManager } from './audio/AudioManager';
import { BLOCK_INFO, colorToNumber, dropFor, isSolidBlock } from './core/blockInfo';
import { BLOCK_SIZE, BlockId, CHUNK_SIZE } from './core/constants';
import { blockToChunkCoord, worldToBlockCoord } from './core/coords';
import { seedFromText } from './core/random';
import { showDebugMap } from './dev/debugMap';
import { createHud } from './dev/hud';
import {
  runPhase1Tests,
  runPhase2Tests,
  runPhase4Tests,
  runPhase5Tests,
  runPhase6Tests,
  runPhase7Tests,
  runPhase8Tests,
  runPhase9Tests,
  runPhase10Tests,
  verifyWorkerChunk,
} from './dev/tests';
import { EnemyManager } from './entities/EnemyManager';
import { Inventory } from './items/Inventory';
import { TORCH_RECIPE, craftTorches } from './items/crafting';
import { LightField } from './lighting/LightField';
import { BlockEditor } from './player/BlockEditor';
import { Player } from './player/Player';
import type { InputState } from './player/Player';
import { Camera } from './render/Camera';
import { ChunkRenderer } from './render/ChunkRenderer';
import { EnemyRenderer } from './render/EnemyRenderer';
import { LightRenderer } from './render/LightRenderer';
import { Particles } from './render/Particles';
import { createBackgroundTextures, createTileTextures, createTorchTexture } from './render/atlas';
import { GameUi } from './ui/GameUi';
import { LoadingScreen, PauseMenu, showTitleScreen } from './ui/Menu';
import { ChunkStore } from './world/ChunkStore';
import { ChunkWorkerPool } from './world/ChunkWorkerPool';
import { WorldGenerator } from './world/WorldGenerator';
import { WorldManager } from './world/WorldManager';
import { torchHasSupport } from './world/torchRules';

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;
const ATTACK_DAMAGE = 10;
const ATTACK_COOLDOWN = 0.35; // s entre golpes
const PRELOAD_RADIUS = 3; // chunks que se generan antes de empezar (7x7 = 49)
const LAST_SEED_KEY = 'terraria-pixi-last-seed';

// Iluminación
const PLAYER_LIGHT_RADIUS = 10; // bloques
const MAX_LIGHT_RADIUS = 12; // tope del campo de luz (la antorcha parpadea hasta ~8,6)
const ENEMY_LIGHT_OPACITY = 0.6; // fracción de luz que absorbe un enemigo
const STARTING_TORCHES = 20;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readLastSeed(): string | null {
  try {
    return localStorage.getItem(LAST_SEED_KEY);
  } catch {
    return null;
  }
}

function writeLastSeed(text: string): void {
  try {
    localStorage.setItem(LAST_SEED_KEY, text);
  } catch {
    /* ignorar */
  }
}

let loadingScreen: LoadingScreen | null = null;

async function main() {
  if (import.meta.env.DEV) {
    runPhase1Tests();
    runPhase2Tests();
    runPhase4Tests();
    runPhase5Tests();
    runPhase6Tests();
    runPhase7Tests();
    runPhase8Tests();
    runPhase9Tests();
    runPhase10Tests();
  }

  // ?debug = mapa 2D · ?autostart = saltar el menú · ?seed=123 · ?reset = borrar guardado
  // ?noworker = generar en el hilo principal (para comparar rendimiento)
  const params = new URLSearchParams(location.search);

  if (params.has('debug')) {
    showDebugMap(seedFromText(params.get('seed'), 12345));
    return;
  }

  // El audio solo se puede activar tras un gesto del usuario
  const audio = new AudioManager();
  const unlockAudio = () => audio.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  let seed: number;
  let reset: boolean;
  if (params.has('autostart') || params.has('reset')) {
    seed = seedFromText(params.get('seed'), 12345);
    reset = params.has('reset');
  } else {
    const choice = await showTitleScreen(params.get('seed') ?? readLastSeed() ?? '12345', () => audio.unlock());
    seed = choice.seed;
    reset = choice.reset;
    writeLastSeed(choice.seedText);
  }
  if (params.has('reset')) {
    params.delete('reset'); // evita borrar de nuevo en cada recarga
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  }

  const loading = new LoadingScreen();
  loadingScreen = loading;
  loading.setProgress(0.03, 'Preparando el motor gráfico…');

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#000000',
    antialias: false,
    roundPixels: true,
  });
  document.body.appendChild(app.canvas);

  const gen = new WorldGenerator(seed);
  const world = new WorldManager((chunk) => gen.generateChunk(chunk));
  const getBlockFn = (bx: number, by: number): number => world.getBlock(bx, by);
  const getChunkFn = (cx: number, cy: number) => world.getChunk(cx, cy);

  // Persistencia del mundo: se cargan las ediciones ANTES de crear el primer chunk
  loading.setProgress(0.08, 'Abriendo el guardado…');
  let store: ChunkStore | null = null;
  try {
    store = await ChunkStore.open(seed);
    if (reset) await store.clear();
    else world.loadEdits(await store.loadAll());
  } catch (err) {
    console.warn('IndexedDB no disponible: los cambios no se guardarán', err);
    store = null;
  }

  // Inventario (se guarda en localStorage, aparte del mundo)
  const invKey = `terraria-pixi-inv-${seed}`;
  const giftKey = `terraria-pixi-torches-${seed}`;
  const inventory = new Inventory();
  try {
    if (reset) {
      localStorage.removeItem(invKey);
      localStorage.removeItem(giftKey);
    } else {
      const raw = localStorage.getItem(invKey);
      if (raw) inventory.restore(raw);
    }
  } catch {
    /* localStorage no disponible: el inventario no se guardará */
  }

  let invDirty = false;
  function saveInventory(): void {
    if (!invDirty) return;
    invDirty = false;
    try {
      localStorage.setItem(invKey, inventory.serialize());
    } catch {
      /* ignorar */
    }
  }

  const ui = new GameUi(inventory);
  inventory.onChange = () => {
    ui.render();
    invDirty = true;
  };

  // Regalo inicial de antorchas: una sola vez por mundo (también en mundos que ya tenías)
  try {
    if (!localStorage.getItem(giftKey)) {
      inventory.add(BlockId.TORCH, STARTING_TORCHES);
      localStorage.setItem(giftKey, '1');
      ui.showMessage(`Recibiste ${STARTING_TORCHES} antorchas: selecciónalas y colócalas con el clic derecho`);
    }
  } catch {
    /* sin localStorage no hay regalo */
  }

  const persist = store;
  let saving = false;
  async function flush(): Promise<void> {
    saveInventory();
    if (!persist || saving) return;
    const entries = world.takeModified();
    if (entries.length === 0) return;
    saving = true;
    try {
      await persist.saveMany(entries);
    } catch (err) {
      console.error('No se pudo guardar; se reintentará', err);
      for (const [key] of entries) world.markModified(key);
    } finally {
      saving = false;
    }
  }
  /** Espera a que termine un guardado en curso y guarda lo último (para salir al menú). */
  async function flushNow(): Promise<void> {
    for (let i = 0; i < 50 && saving; i++) await sleep(20);
    await flush();
  }
  setInterval(() => void flush(), 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flush();
  });
  window.addEventListener('pagehide', () => void flush());

  // Render
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  const bg = createBackgroundTextures();
  const chunkRenderer = new ChunkRenderer({
    renderer: app.renderer,
    tileTextures: createTileTextures(),
    sky: bg.sky,
    cave: bg.cave,
    torchTexture: createTorchTexture(),
    surfaceHeight: (bx) => gen.surfaceHeight(bx),
    getBlock: getBlockFn,
  });
  worldContainer.addChild(chunkRenderer.container);

  world.onChunkLoaded = (chunk) => chunkRenderer.addChunk(chunk);
  world.onChunkUnloaded = (chunk) => chunkRenderer.removeChunk(chunk);
  world.onBlockChanged = (bx, by) => chunkRenderer.onBlockChanged(bx, by);

  // Generación en Web Workers (con fallback a generar en el hilo principal)
  loading.setProgress(0.12, 'Iniciando los generadores de terreno…');
  let pool: ChunkWorkerPool | null = null;
  let verified = 0;
  if (typeof Worker !== 'undefined' && !params.has('noworker')) {
    try {
      pool = new ChunkWorkerPool({
        seed: gen.seed,
        size: Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)),
        onResult: (cx, cy, blocks, ms) => {
          if (import.meta.env.DEV && verified < 3) {
            verified++;
            verifyWorkerChunk(gen, cx, cy, blocks, ms);
          }
          world.insertGenerated(cx, cy, blocks);
        },
        onFatal: (err) => {
          console.error('Fallo en un worker: se genera en el hilo principal', err);
          world.setProvider(null);
          ui.showMessage('Workers no disponibles: generando en el hilo principal');
        },
      });
      world.setProvider(pool);
    } catch (err) {
      console.warn('No se pudieron crear los workers: se genera en el hilo principal', err);
      pool = null;
    }
  }

  // Partículas, enemigos y jugador
  const particles = new Particles();

  const enemies = new EnemyManager(world);
  const enemyRenderer = new EnemyRenderer();
  enemies.onAdd = (e) => enemyRenderer.add(e);
  enemies.onRemove = (e) => enemyRenderer.remove(e);
  worldContainer.addChild(enemyRenderer.container);

  const player = new Player(world);
  const playerGfx = new Graphics();
  playerGfx
    .rect(0, 0, player.width, player.height)
    .fill(0xf5a623)
    .stroke({ width: 1, color: 0x000000, alpha: 0.6 });
  worldContainer.addChild(playerGfx);
  worldContainer.addChild(particles.container);

  // Iluminación: la oscuridad va encima de entidades y partículas, pero debajo del cursor
  const lightRenderer = new LightRenderer();
  const LIGHT_SCALE = 2; // muestras de luz por bloque y eje (1 = sin supersampling, 3 = más suave pero más caro)
  const lightField = new LightField(MAX_LIGHT_RADIUS, LIGHT_SCALE);
  worldContainer.addChild(lightRenderer.sprite);
  const surfCols: number[] = [];
  let lightTime = 0;
  let lightMs = 0;

  // Edición con el ratón
  let freeCam = false;
  let lighting = true;
  let debugOn = false;
  let attackCd = 0;

  const editor = new BlockEditor({ canvas: app.canvas, worldContainer, world });
  worldContainer.addChild(editor.cursor);

  editor.canEdit = (bx, by, placing) => {
    if (!freeCam && !player.canReach(bx, by)) return false;
    if (placing) {
      const item = inventory.selectedItem();
      if (item === null) return false;
      if (isSolidBlock(item)) return !player.overlapsBlock(bx, by);
      return torchHasSupport(getBlockFn, bx, by); // los ítems no sólidos (antorchas) necesitan apoyo
    }
    const drop = dropFor(world.getBlock(bx, by));
    return drop === null || inventory.canAdd(drop); // inventario lleno: no se mina
  };
  editor.getPlaceBlock = () => inventory.selectedItem();

  /** Tras minar un bloque, las antorchas que se apoyaban en él se sueltan y vuelven al inventario. */
  function dropUnsupportedTorches(bx: number, by: number): void {
    const around: Array<[number, number]> = [[bx - 1, by], [bx + 1, by], [bx, by - 1]];
    for (const [x, y] of around) {
      if (world.getBlock(x, y) !== BlockId.TORCH) continue;
      if (torchHasSupport(getBlockFn, x, y)) continue;
      if (!inventory.canAdd(BlockId.TORCH)) continue; // sin sitio: la antorcha queda flotando
      world.setBlock(x, y, BlockId.AIR);
      inventory.add(BlockId.TORCH);
      particles.burst((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, colorToNumber(BLOCK_INFO[BlockId.TORCH].color), 5, 60);
    }
  }

  editor.onMine = (id, bx, by) => {
    const drop = dropFor(id);
    if (drop !== null) inventory.add(drop);
    particles.burst((bx + 0.5) * BLOCK_SIZE, (by + 0.5) * BLOCK_SIZE, colorToNumber(BLOCK_INFO[id].color));
    audio.play('mine');
    dropUnsupportedTorches(bx, by);
  };
  editor.onPlace = () => {
    inventory.consumeSelected();
    audio.play('place');
  };
  // Clic izquierdo sobre un enemigo = ataque (en vez de minar el bloque que hay detrás)
  editor.tryInteract = (wx, wy, placing) => {
    if (placing) return false;
    const target = enemies.hitTest(wx, wy, 4);
    if (!target) return false;
    if (attackCd <= 0 && (freeCam || player.canReachPoint(target.cx, target.cy))) {
      attackCd = ATTACK_COOLDOWN;
      const dir = target.cx >= player.x + player.width / 2 ? 1 : -1;
      particles.burst(target.cx, target.cy, 0x4cd964, 6, 100);
      audio.play('hit');
      if (target.damage(ATTACK_DAMAGE, dir)) enemies.remove(target);
    }
    return true;
  };

  // Cámara
  const camera = new Camera(worldContainer);

  /** Genera de forma SÍNCRONA los chunks alrededor de un punto (solo para aparecer/reaparecer). */
  function forceLoadAround(bx: number, by: number, r: number): void {
    const ccx = blockToChunkCoord(bx);
    const ccy = blockToChunkCoord(by);
    for (let cy = ccy - r; cy <= ccy + r; cy++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) world.getOrCreateChunk(cx, cy);
    }
  }

  function spawnPlayer(): void {
    const surf = gen.surfaceHeight(0);
    forceLoadAround(0, surf, 1); // el terreno bajo el jugador debe existir ya
    player.respawn((BLOCK_SIZE - player.width) / 2, surf * BLOCK_SIZE - player.height - 1);
    for (let i = 0; i < 200 && player.isOverlapping(); i++) player.y -= BLOCK_SIZE;
    camera.x = player.x + player.width / 2;
    camera.y = player.y + player.height / 2;
  }

  // Precarga del terreno de aparición con barra de progreso
  const surf0 = gen.surfaceHeight(0);
  camera.x = BLOCK_SIZE / 2;
  camera.y = surf0 * BLOCK_SIZE;
  const spawnCx = blockToChunkCoord(0);
  const spawnCy = blockToChunkCoord(surf0);
  const preloadTotal = (2 * PRELOAD_RADIUS + 1) ** 2;
  const deadline = performance.now() + 20000;
  chunkRenderer.maxBuildsPerFrame = 12; // durante la carga se pueden construir más texturas por frame
  for (;;) {
    world.update(0, surf0, PRELOAD_RADIUS);
    const loaded = world.loadedInArea(spawnCx, spawnCy, PRELOAD_RADIUS);
    const b = camera.bounds(app.screen.width, app.screen.height);
    chunkRenderer.update(b.left, b.top, b.right, b.bottom);
    loading.setProgress(0.2 + 0.75 * (loaded / preloadTotal), `Generando el terreno… ${loaded}/${preloadTotal}`);
    if (loaded >= preloadTotal) break;
    if (performance.now() > deadline) {
      console.warn('La precarga tardó demasiado: se completa en el hilo principal');
      forceLoadAround(0, surf0, PRELOAD_RADIUS);
      break;
    }
    await nextFrame();
  }
  chunkRenderer.maxBuildsPerFrame = 4;
  spawnPlayer();

  // Entrada, pausa y menú
  const keys = new Set<string>();
  let paused = false;

  const pauseMenu = new PauseMenu({
    onResume: () => setPaused(false),
    onToggleMusic: () => audio.setMusic(!audio.musicOn),
    onToggleSfx: () => audio.setSfx(!audio.sfxOn),
    onQuit: () => {
      void quitToMenu();
    },
  });

  function setPaused(p: boolean): void {
    paused = p;
    keys.clear();
    if (p) pauseMenu.show(audio.musicOn, audio.sfxOn);
    else pauseMenu.hide();
  }

  async function quitToMenu(): Promise<void> {
    await flushNow();
    location.assign(location.pathname); // vuelve al menú principal (sin parámetros)
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F3') {
      e.preventDefault();
      if (!e.repeat) debugOn = !debugOn;
      return;
    }
    if (e.key === 'Escape') {
      if (!e.repeat) setPaused(!paused);
      return;
    }
    if (paused) return;

    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    if (k === 'f') freeCam = !freeCam; // cámara libre para depurar
    if (k === 'r') spawnPlayer(); // reaparecer
    if (k === 'l') {
      lighting = !lighting;
      ui.showMessage(lighting ? 'Iluminación activada' : 'Iluminación desactivada');
    }
    if (k === 'k') {
      lightRenderer.blurPasses = (lightRenderer.blurPasses + 1) % 4;
      ui.showMessage(`Suavizado de sombras: ${lightRenderer.blurPasses} pasadas`);
    }
    if (k === 'm') {
      const on = audio.setMusic(!audio.musicOn);
      ui.showMessage(on ? 'Música activada' : 'Música desactivada');
    }
    if (k === 'c') {
      const result = craftTorches(inventory);
      ui.showMessage(
        result === 'ok'
          ? `Fabricaste ${TORCH_RECIPE.torches} antorchas (−${TORCH_RECIPE.coal} de carbón)`
          : result === 'no-coal'
            ? `Necesitas ${TORCH_RECIPE.coal} de carbón para fabricar antorchas`
            : 'Inventario lleno',
      );
    }
    if (/^[0-9]$/.test(e.key)) inventory.select(e.key === '0' ? 9 : Number(e.key) - 1);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!paused) camera.setZoom(camera.zoom + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );

  // Todo listo: se quita la pantalla de carga
  loading.setProgress(1, 'Listo');
  loading.hide();

  const input: InputState = { left: false, right: false, jump: false };
  const setHud = createHud();
  let hudTimer = 0;
  let frameMax = 0; // el fotograma más largo desde la última actualización del HUD

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    frameMax = Math.max(frameMax, ticker.deltaMS);
    if (paused) return;
    attackCd = Math.max(0, attackCd - dt);

    if (freeCam) {
      const speed = (600 * (keys.has('shift') ? 4 : 1)) / camera.zoom;
      if (keys.has('a') || keys.has('arrowleft')) camera.x -= speed * dt;
      if (keys.has('d') || keys.has('arrowright')) camera.x += speed * dt;
      if (keys.has('w') || keys.has('arrowup')) camera.y -= speed * dt;
      if (keys.has('s') || keys.has('arrowdown')) camera.y += speed * dt;
    } else {
      input.left = keys.has('a') || keys.has('arrowleft');
      input.right = keys.has('d') || keys.has('arrowright');
      input.jump = keys.has(' ') || keys.has('w') || keys.has('arrowup');

      const hpBefore = player.health;
      player.update(dt, input);
      enemies.update(dt, player);
      if (player.health < hpBefore) audio.play(player.health <= 0 ? 'death' : 'hurt');

      if (player.health <= 0) {
        enemies.clear();
        spawnPlayer();
        ui.showMessage('Has muerto: reapareces en la superficie');
      }

      // La cámara persigue al jugador con suavizado exponencial
      const k = 1 - Math.exp(-10 * dt);
      camera.x += (player.x + player.width / 2 - camera.x) * k;
      camera.y += (player.y + player.height / 2 - camera.y) * k;
    }

    playerGfx.position.set(player.x, player.y);
    // Parpadeo mientras dura la invulnerabilidad
    playerGfx.alpha = player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0 ? 0.4 : 1;
    enemyRenderer.sync();
    particles.update(dt);
    ui.setHealth(player.health, player.maxHealth);

    const w = app.screen.width;
    const h = app.screen.height;
    camera.apply(w, h);

    const radius = Math.ceil(Math.max(w, h) / camera.zoom / 2 / CHUNK_PX) + 1;
    world.update(worldToBlockCoord(camera.x), worldToBlockCoord(camera.y), radius);

    editor.update();
    editor.cursor.tint = freeCam || player.canReach(editor.hoverX, editor.hoverY) ? 0xffffff : 0xff4444;

    const b = camera.bounds(w, h);
    chunkRenderer.update(b.left, b.top, b.right, b.bottom);

    const pbx = worldToBlockCoord(player.x + player.width / 2);
    const pby = worldToBlockCoord(player.y + player.height / 2);
    const depth = pby - gen.surfaceHeight(pbx);

    // Iluminación por ray casting: bloques y enemigos bloquean la luz del jugador y de las antorchas
    if (lighting && !freeCam) {
      const t0 = performance.now();
      lightTime += dt;

      // Tamaño fijo para una pantalla y un zoom dados (evita reservar memoria cada vez que se mueve la cámara)
      const gx0 = Math.floor(b.left / BLOCK_SIZE) - 1;
      const gy0 = Math.floor(b.top / BLOCK_SIZE) - 1;
      const gw = Math.ceil((b.right - b.left) / BLOCK_SIZE) + 3;
      const gh = Math.ceil((b.bottom - b.top) / BLOCK_SIZE) + 3;

      lightField.begin(gx0, gy0, gw, gh);
      lightField.scan(getChunkFn);
      for (const e of enemies.enemies) {
        lightField.stampRect(
          e.x / BLOCK_SIZE,
          e.y / BLOCK_SIZE,
          (e.x + e.width) / BLOCK_SIZE,
          (e.y + e.height) / BLOCK_SIZE,
          ENEMY_LIGHT_OPACITY,
        );
      }
      lightField.addLight(
        (player.x + player.width / 2) / BLOCK_SIZE,
        (player.y + player.height / 2) / BLOCK_SIZE,
        PLAYER_LIGHT_RADIUS,
        1,
      );
      lightField.addBlockLights(lightTime);

      for (let i = 0; i < gw; i++) surfCols[i] = gen.surfaceHeight(gx0 + i);
      lightRenderer.update(lightField, surfCols);
      lightMs = performance.now() - t0;
    } else {
      lightRenderer.hide();
      lightMs = 0;
    }

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const under = world.getBlock(editor.hoverX, editor.hoverY);
      const selected = inventory.selectedItem();
      const lines = [
        `FPS ${app.ticker.FPS.toFixed(0)} · chunks ${world.loadedCount} (visibles ${chunkRenderer.visibleCount}) · zoom ${camera.zoom}x`,
        `jugador (${pbx}, ${pby}) · profundidad ${depth} · ${player.onGround ? 'en suelo' : 'en el aire'}`,
        `cursor (${editor.hoverX}, ${editor.hoverY}) = ${BLOCK_INFO[under].name} · enemigos ${enemies.enemies.length}`,
        `A/D mover · Espacio/W saltar · clic izq. minar/atacar · clic der. construir/antorcha${selected === BlockId.TORCH ? ' (necesita apoyo)' : ''}`,
        `1-0 slot · C fabricar antorchas · Esc pausa · M música · L luz ${lighting ? 'ON' : 'OFF'} · F cámara libre ${freeCam ? '(ACTIVA)' : ''} · R reaparecer · F3 depuración`,
      ];

      if (debugOn) {
        const ps = chunkRenderer.poolStats;
        const active = chunkRenderer.activeTextures;
        const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        lines.push(
          '── DEPURACIÓN ──',
          `fotograma más largo (0,25 s): ${frameMax.toFixed(1)} ms`,
          `luz: ${lightField.lightsCast} fuentes · ${lightField.raysCast} rayos · ${lightMs.toFixed(2)} ms · rejilla ${lightField.gw}x${lightField.gh} · muestras ${lightField.sw}x${lightField.sh} · blur ${lightRenderer.blurPasses}`,
          `chunks: cargados ${world.loadedCount} · visibles ${chunkRenderer.visibleCount} · pendientes ${world.pendingCount}`,
          pool
            ? `workers: ${pool.size} · en cola ${pool.queued} · en curso ${pool.inFlight} · gen. media ${pool.avgMs.toFixed(2)} ms · generados ${pool.completed}`
            : 'workers: desactivados (generación en el hilo principal)',
          `texturas de chunk: ${active} en uso (≈ ${active} MB) · pool: creadas ${ps.created} · reutilizadas ${ps.reused} · inactivas ${ps.idle} · destruidas ${ps.destroyed}`,
          `partículas ${particles.activeCount} · música ${audio.musicOn ? 'sí' : 'no'} · efectos ${audio.sfxOn ? 'sí' : 'no'}`,
          mem ? `memoria JS: ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'memoria JS: no disponible en este navegador',
        );
      }
      frameMax = 0;
      setHud(lines.join('\n'));
    }
  });
}

main().catch((err) => {
  console.error(err);
  loadingScreen?.fail(err instanceof Error ? err.message : String(err));
});