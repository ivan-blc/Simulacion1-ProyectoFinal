import { Application, Container, Graphics } from 'pixi.js';
import { BLOCK_SIZE, BlockId, CHUNK_SIZE } from './core/constants';
import { worldToBlockCoord } from './core/coords';
import { showDebugMap } from './dev/debugMap';
import { createHud } from './dev/hud';
import { runPhase1Tests, runPhase2Tests, runPhase4Tests, runPhase5Tests } from './dev/tests';
import { BlockEditor } from './player/BlockEditor';
import { Player } from './player/Player';
import type { InputState } from './player/Player';
import { Camera } from './render/Camera';
import { ChunkRenderer } from './render/ChunkRenderer';
import { createBackgroundTextures, createBlockTextures } from './render/atlas';
import { ChunkStore } from './world/ChunkStore';
import { WorldGenerator } from './world/WorldGenerator';
import { WorldManager } from './world/WorldManager';

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;

const BLOCK_NAMES: Record<number, string> = {
  [BlockId.AIR]: 'aire',
  [BlockId.DIRT]: 'tierra',
  [BlockId.STONE]: 'piedra',
  [BlockId.GRASS]: 'pasto',
};

async function main() {
  runPhase1Tests();
  runPhase2Tests();
  runPhase4Tests();
  runPhase5Tests();

  // ?debug = mapa 2D · ?seed=123 = semilla · ?reset = borrar los cambios guardados
  const params = new URLSearchParams(location.search);
  const parsed = Number(params.get('seed') ?? 12345);
  const seed = Number.isFinite(parsed) ? parsed : 12345;

  if (params.has('debug')) {
    showDebugMap(seed);
    return;
  }

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

  // Persistencia: se cargan las ediciones ANTES de crear el primer chunk
  let store: ChunkStore | null = null;
  try {
    store = await ChunkStore.open(seed);
    if (params.has('reset')) {
      await store.clear();
      params.delete('reset');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
    } else {
      world.loadEdits(await store.loadAll());
    }
  } catch (err) {
    console.warn('IndexedDB no disponible: los cambios no se guardarán', err);
    store = null;
  }

  const persist = store;
  let saving = false;
  async function flush(): Promise<void> {
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
    blockTextures: createBlockTextures(),
    sky: bg.sky,
    cave: bg.cave,
    surfaceHeight: (bx) => gen.surfaceHeight(bx),
  });
  worldContainer.addChild(chunkRenderer.container);

  world.onChunkLoaded = (chunk) => chunkRenderer.addChunk(chunk);
  world.onChunkUnloaded = (chunk) => chunkRenderer.removeChunk(chunk);

  // Jugador (un rectángulo por ahora; se dibuja entre los chunks y el cursor)
  const player = new Player(world);
  const playerGfx = new Graphics();
  playerGfx
    .rect(0, 0, player.width, player.height)
    .fill(0xf5a623)
    .stroke({ width: 1, color: 0x000000, alpha: 0.6 });
  worldContainer.addChild(playerGfx);

  // Edición con el ratón, limitada por el alcance del jugador
  let freeCam = false;
  const editor = new BlockEditor({ canvas: app.canvas, worldContainer, world });
  worldContainer.addChild(editor.cursor);
  editor.canEdit = (bx, by, placing) =>
    (freeCam || player.canReach(bx, by)) && (!placing || !player.overlapsBlock(bx, by));

  // Cámara
  const camera = new Camera(worldContainer);

  function spawnPlayer(): void {
    const surf = gen.surfaceHeight(0);
    world.update(0, surf, 2); // el terreno bajo el jugador debe existir antes de empezar
    player.respawn((BLOCK_SIZE - player.width) / 2, surf * BLOCK_SIZE - player.height - 1);
    // Si hay bloques construidos en el punto de aparición, sube hasta encontrar hueco
    for (let i = 0; i < 200 && player.isOverlapping(); i++) player.y -= BLOCK_SIZE;
    camera.x = player.x + player.width / 2;
    camera.y = player.y + player.height / 2;
  }
  spawnPlayer();

  // Entrada
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    if (k === 'f') freeCam = !freeCam; // cámara libre para depurar
    if (k === 'r') spawnPlayer(); // reaparecer
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camera.setZoom(camera.zoom + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );

  const input: InputState = { left: false, right: false, jump: false };
  const setHud = createHud();
  let hudTimer = 0;

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;

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
      player.update(dt, input);

      // La cámara persigue al jugador con suavizado exponencial (independiente de los FPS)
      const k = 1 - Math.exp(-10 * dt);
      camera.x += (player.x + player.width / 2 - camera.x) * k;
      camera.y += (player.y + player.height / 2 - camera.y) * k;
    }
    playerGfx.position.set(player.x, player.y);

    const w = app.screen.width;
    const h = app.screen.height;
    camera.apply(w, h);

    const radius = Math.ceil(Math.max(w, h) / camera.zoom / 2 / CHUNK_PX) + 1;
    world.update(worldToBlockCoord(camera.x), worldToBlockCoord(camera.y), radius);

    editor.update();
    // El cursor se tiñe de rojo cuando el bloque está fuera de alcance
    editor.cursor.tint = freeCam || player.canReach(editor.hoverX, editor.hoverY) ? 0xffffff : 0xff4444;

    const b = camera.bounds(w, h);
    chunkRenderer.update(b.left, b.top, b.right, b.bottom);

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const under = world.getBlock(editor.hoverX, editor.hoverY);
      setHud(
        `FPS ${app.ticker.FPS.toFixed(0)} · chunks ${world.loadedCount} (visibles ${chunkRenderer.visibleCount}) · zoom ${camera.zoom}x\n` +
          `jugador (${worldToBlockCoord(player.x + player.width / 2)}, ${worldToBlockCoord(player.y + player.height / 2)}) · ` +
          `${player.onGround ? 'en suelo' : 'en el aire'} · vel (${player.vx.toFixed(0)}, ${player.vy.toFixed(0)})\n` +
          `cursor (${editor.hoverX}, ${editor.hoverY}) = ${BLOCK_NAMES[under]}\n` +
          `bloque a colocar: ${BLOCK_NAMES[editor.selected]} (teclas 1-3)\n` +
          `A/D mover · Espacio/W saltar · clic izq. minar · clic der. construir\n` +
          `F cámara libre ${freeCam ? '(ACTIVA)' : ''} · R reaparecer · rueda zoom`,
      );
    }
  });
}

main();