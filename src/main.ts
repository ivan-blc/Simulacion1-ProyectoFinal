import { Application, Container } from 'pixi.js';
import { BLOCK_SIZE, CHUNK_SIZE } from './core/constants';
import { worldToBlockCoord } from './core/coords';
import { showDebugMap } from './dev/debugMap';
import { createHud } from './dev/hud';
import { runPhase1Tests, runPhase2Tests } from './dev/tests';
import { Camera } from './render/Camera';
import { ChunkRenderer } from './render/ChunkRenderer';
import { createBackgroundTextures, createBlockTextures } from './render/atlas';
import { WorldGenerator } from './world/WorldGenerator';
import { WorldManager } from './world/WorldManager';

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;

async function main() {
  runPhase1Tests();
  runPhase2Tests();

  // ?debug muestra el mapa 2D; ?seed=123 fija la semilla
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

  // Mundo + generación
  const gen = new WorldGenerator(seed);
  const world = new WorldManager((chunk) => gen.generateChunk(chunk));

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

  // Cámara libre, empieza sobre la superficie
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

    // Movimiento: velocidad constante en pantalla, sea cual sea el zoom
    const speed = (600 * (keys.has('shift') ? 4 : 1)) / camera.zoom;
    if (keys.has('a') || keys.has('arrowleft')) camera.x -= speed * dt;
    if (keys.has('d') || keys.has('arrowright')) camera.x += speed * dt;
    if (keys.has('w') || keys.has('arrowup')) camera.y -= speed * dt;
    if (keys.has('s') || keys.has('arrowdown')) camera.y += speed * dt;

    const w = app.screen.width;
    const h = app.screen.height;
    camera.apply(w, h);

    // Cargar alrededor de la cámara (radio según el tamaño de pantalla y el zoom)
    const radius = Math.ceil(Math.max(w, h) / camera.zoom / 2 / CHUNK_PX) + 1;
    world.update(worldToBlockCoord(camera.x), worldToBlockCoord(camera.y), radius);

    // Culling + reconstrucción de chunks sucios
    const b = camera.bounds(w, h);
    chunkRenderer.update(b.left, b.top, b.right, b.bottom);

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      setHud(
        `FPS ${app.ticker.FPS.toFixed(0)}\n` +
          `chunks cargados ${world.loadedCount} · visibles ${chunkRenderer.visibleCount}\n` +
          `zoom ${camera.zoom}x · bloque (${worldToBlockCoord(camera.x)}, ${worldToBlockCoord(camera.y)})\n` +
          `WASD/flechas mover · Shift rápido · rueda zoom`,
      );
    }
  });
}

main();