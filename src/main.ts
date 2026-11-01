import { Application, Container, Graphics } from 'pixi.js';
import { BLOCK_INFO, dropFor } from './core/blockInfo';
import { BLOCK_SIZE, CHUNK_SIZE } from './core/constants';
import { worldToBlockCoord } from './core/coords';
import { showDebugMap } from './dev/debugMap';
import { createHud } from './dev/hud';
import {
  runPhase1Tests,
  runPhase2Tests,
  runPhase4Tests,
  runPhase5Tests,
  runPhase6Tests,
} from './dev/tests';
import { EnemyManager } from './entities/EnemyManager';
import { Inventory } from './items/Inventory';
import { BlockEditor } from './player/BlockEditor';
import { Player } from './player/Player';
import type { InputState } from './player/Player';
import { Camera } from './render/Camera';
import { ChunkRenderer } from './render/ChunkRenderer';
import { Darkness } from './render/Darkness';
import { EnemyRenderer } from './render/EnemyRenderer';
import { createBackgroundTextures, createBlockTextures } from './render/atlas';
import { GameUi } from './ui/GameUi';
import { ChunkStore } from './world/ChunkStore';
import { WorldGenerator } from './world/WorldGenerator';
import { WorldManager } from './world/WorldManager';

const CHUNK_PX = CHUNK_SIZE * BLOCK_SIZE;
const ATTACK_DAMAGE = 10;
const ATTACK_COOLDOWN = 0.35; // s entre golpes
const LIGHT_RADIUS_BLOCKS = 9;

async function main() {
  runPhase1Tests();
  runPhase2Tests();
  runPhase4Tests();
  runPhase5Tests();
  runPhase6Tests();

  // ?debug = mapa 2D · ?seed=123 = semilla · ?reset = borrar cambios e inventario guardados
  const params = new URLSearchParams(location.search);
  const parsed = Number(params.get('seed') ?? 12345);
  const seed = Number.isFinite(parsed) ? parsed : 12345;
  const reset = params.has('reset');

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

  // Persistencia del mundo: se cargan las ediciones ANTES de crear el primer chunk
  let store: ChunkStore | null = null;
  try {
    store = await ChunkStore.open(seed);
    if (reset) await store.clear();
    else world.loadEdits(await store.loadAll());
  } catch (err) {
    console.warn('IndexedDB no disponible: los cambios no se guardarán', err);
    store = null;
  }
  if (reset) {
    params.delete('reset'); // evita borrar de nuevo en cada recarga
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  }

  // Inventario (se guarda en localStorage, aparte del mundo)
  const invKey = `terraria-pixi-inv-${seed}`;
  const inventory = new Inventory();
  try {
    if (reset) localStorage.removeItem(invKey);
    else {
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

  // Enemigos
  const enemies = new EnemyManager(world);
  const enemyRenderer = new EnemyRenderer();
  enemies.onAdd = (e) => enemyRenderer.add(e);
  enemies.onRemove = (e) => enemyRenderer.remove(e);
  worldContainer.addChild(enemyRenderer.container);

  // Jugador (un rectángulo por ahora)
  const player = new Player(world);
  const playerGfx = new Graphics();
  playerGfx
    .rect(0, 0, player.width, player.height)
    .fill(0xf5a623)
    .stroke({ width: 1, color: 0x000000, alpha: 0.6 });
  worldContainer.addChild(playerGfx);

  // Edición con el ratón
  let freeCam = false;
  let lighting = true;
  let attackCd = 0;

  const editor = new BlockEditor({ canvas: app.canvas, worldContainer, world });
  worldContainer.addChild(editor.cursor);

  editor.canEdit = (bx, by, placing) => {
    if (!freeCam && !player.canReach(bx, by)) return false;
    if (placing) return !player.overlapsBlock(bx, by);
    const drop = dropFor(world.getBlock(bx, by));
    return drop === null || inventory.canAdd(drop); // inventario lleno: no se mina
  };
  editor.getPlaceBlock = () => inventory.selectedItem();
  editor.onMine = (id) => {
    const drop = dropFor(id);
    if (drop !== null) inventory.add(drop);
  };
  editor.onPlace = () => {
    inventory.consumeSelected();
  };
  // Clic izquierdo sobre un enemigo = ataque (en vez de minar el bloque que hay detrás)
  editor.tryInteract = (wx, wy, placing) => {
    if (placing) return false;
    const target = enemies.hitTest(wx, wy, 4);
    if (!target) return false;
    if (attackCd <= 0 && (freeCam || player.canReachPoint(target.cx, target.cy))) {
      attackCd = ATTACK_COOLDOWN;
      const dir = target.cx >= player.x + player.width / 2 ? 1 : -1;
      if (target.damage(ATTACK_DAMAGE, dir)) enemies.remove(target);
    }
    return true;
  };

  // Cámara
  const camera = new Camera(worldContainer);

  function spawnPlayer(): void {
    const surf = gen.surfaceHeight(0);
    world.update(0, surf, 2); // el terreno bajo el jugador debe existir antes de empezar
    player.respawn((BLOCK_SIZE - player.width) / 2, surf * BLOCK_SIZE - player.height - 1);
    for (let i = 0; i < 200 && player.isOverlapping(); i++) player.y -= BLOCK_SIZE;
    camera.x = player.x + player.width / 2;
    camera.y = player.y + player.height / 2;
  }
  spawnPlayer();

  // Iluminación (capa de pantalla, encima del mundo)
  const darkness = new Darkness();
  app.stage.addChild(darkness.container);
  let darkLevel = 0;

  // Entrada
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
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
    if (/^[0-9]$/.test(e.key)) inventory.select(e.key === '0' ? 9 : Number(e.key) - 1);
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
      player.update(dt, input);
      enemies.update(dt, player);

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

    // Oscuridad según la profundidad bajo la superficie de la columna del jugador
    const pbx = worldToBlockCoord(player.x + player.width / 2);
    const pby = worldToBlockCoord(player.y + player.height / 2);
    const depth = pby - gen.surfaceHeight(pbx);
    const targetDark = lighting && !freeCam ? Math.min(1, Math.max(0, (depth - 6) / 30)) * 0.93 : 0;
    darkLevel += (targetDark - darkLevel) * (1 - Math.exp(-3 * dt));
    darkness.update(
      w,
      h,
      worldContainer.x + (player.x + player.width / 2) * camera.zoom,
      worldContainer.y + (player.y + player.height / 2) * camera.zoom,
      LIGHT_RADIUS_BLOCKS * BLOCK_SIZE * camera.zoom,
      darkLevel,
    );

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const under = world.getBlock(editor.hoverX, editor.hoverY);
      setHud(
        `FPS ${app.ticker.FPS.toFixed(0)} · chunks ${world.loadedCount} (visibles ${chunkRenderer.visibleCount}) · zoom ${camera.zoom}x\n` +
          `jugador (${pbx}, ${pby}) · profundidad ${depth} · ${player.onGround ? 'en suelo' : 'en el aire'}\n` +
          `cursor (${editor.hoverX}, ${editor.hoverY}) = ${BLOCK_INFO[under].name} · enemigos ${enemies.enemies.length}\n` +
          `A/D mover · Espacio/W saltar · clic izq. minar/atacar · clic der. construir\n` +
          `1-0 elegir slot · L luz ${lighting ? 'ON' : 'OFF'} · F cámara libre ${freeCam ? '(ACTIVA)' : ''} · R reaparecer · rueda zoom`,
      );
    }
  });
}

main();