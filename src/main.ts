import { Application, Container } from 'pixi.js';
import { BLOCK_SIZE, BlockId, CHUNK_SIZE } from './core/constants';
import { worldToBlockCoord } from './core/coords';
import { showDebugMap } from './dev/debugMap';
import { createHud } from './dev/hud';
import { runPhase1Tests, runPhase2Tests, runPhase4Tests } from './dev/tests';
import { BlockEditor } from './player/BlockEditor';
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
      params.delete('reset'); // evita borrar de nuevo en cada recarga
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

  // Edición con el ratón
  const editor = new BlockEditor({ canvas: app.canvas, worldContainer, world });
  worldContainer.addChild(editor.cursor);

  // Cámara libre (Fase 5 la hará seguir al jugador)
  const camera = new Camera(worldContainer);
  camera.x = 0;
  camera.y = gen.surfaceHeight(0) * BLOCK_SIZE;

  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key.startsWith('Arrow')) e.preventDefault();
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

  const setHud = createHud();
  let hudTimer = 0;

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;

    const speed = (600 * (keys.has('shift') ? 4 : 1)) / camera.zoom;
    if (keys.has('a') || keys.has('arrowleft')) camera.x -= speed * dt;
    if (keys.has('d') || keys.has('arrowright')) camera.x += speed * dt;
    if (keys.has('w') || keys.has('arrowup')) camera.y -= speed * dt;
    if (keys.has('s') || keys.has('arrowdown')) camera.y += speed * dt;

    const w = app.screen.width;
    const h = app.screen.height;
    camera.apply(w, h);

    const radius = Math.ceil(Math.max(w, h) / camera.zoom / 2 / CHUNK_PX) + 1;
    world.update(worldToBlockCoord(camera.x), worldToBlockCoord(camera.y), radius);

    // Tras la cámara y antes del render: la edición se ve en el mismo frame
    editor.update();

    const b = camera.bounds(w, h);
    chunkRenderer.update(b.left, b.top, b.right, b.bottom);

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const under = world.getBlock(editor.hoverX, editor.hoverY);
      setHud(
        `FPS ${app.ticker.FPS.toFixed(0)}\n` +
          `chunks cargados ${world.loadedCount} · visibles ${chunkRenderer.visibleCount}\n` +
          `zoom ${camera.zoom}x · cámara (${worldToBlockCoord(camera.x)}, ${worldToBlockCoord(camera.y)})\n` +
          `cursor (${editor.hoverX}, ${editor.hoverY}) = ${BLOCK_NAMES[under]}\n` +
          `bloque a colocar: ${BLOCK_NAMES[editor.selected]} (teclas 1-3)\n` +
          `clic izq. minar · clic der. construir · WASD mover · rueda zoom`,
      );
    }
  });
}

main();