import { BlockId } from '../core/constants';
import { blockToChunkCoord, blockToLocalCoord } from '../core/coords';
import { WorldGenerator } from '../world/WorldGenerator';
import { WorldManager } from '../world/WorldManager';

const VIEW_W = 512; // bloques visibles en horizontal
const VIEW_H = 256; // bloques visibles en vertical
const SCALE = 2;    // píxeles de pantalla por bloque

type RGB = [number, number, number];

const SKY: RGB = [110, 192, 255];
const CAVE: RGB = [28, 22, 34];
const COLORS: Record<number, RGB> = {
  [BlockId.DIRT]: [139, 90, 43],
  [BlockId.STONE]: [122, 122, 122],
  [BlockId.GRASS]: [76, 175, 80],
};

function makeWorld(gen: WorldGenerator): WorldManager {
  return new WorldManager((chunk) => gen.generateChunk(chunk));
}

export function showDebugMap(initialSeed: number): void {
  let seed = initialSeed;
  let gen = new WorldGenerator(seed);
  let world = makeWorld(gen);
  let camX = -VIEW_W / 2;
  let camY = 30;
  let grid = true;

  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:8px;background:#111;color:#ddd;font:13px monospace';

  const info = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  canvas.style.cssText =
    `width:${VIEW_W * SCALE}px;height:${VIEW_H * SCALE}px;max-width:100%;image-rendering:pixelated`;

  root.append(info, canvas);
  document.body.appendChild(root);
  const ctx = canvas.getContext('2d')!;

  function draw() {
    // Cargar los chunks visibles
    const cx0 = blockToChunkCoord(camX);
    const cx1 = blockToChunkCoord(camX + VIEW_W - 1);
    const cy0 = blockToChunkCoord(camY);
    const cy1 = blockToChunkCoord(camY + VIEW_H - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) world.getOrCreateChunk(cx, cy);
    }

    const heights = new Array<number>(VIEW_W);
    for (let px = 0; px < VIEW_W; px++) heights[px] = gen.surfaceHeight(camX + px);

    const img = ctx.createImageData(VIEW_W, VIEW_H);
    const d = img.data;
    for (let py = 0; py < VIEW_H; py++) {
      const by = camY + py;
      for (let px = 0; px < VIEW_W; px++) {
        const bx = camX + px;
        const id = world.getBlock(bx, by);
        let rgb: RGB = id === BlockId.AIR ? (by < heights[px] ? SKY : CAVE) : COLORS[id];

        if (grid && (blockToLocalCoord(bx) === 0 || blockToLocalCoord(by) === 0)) {
          rgb = [rgb[0] * 0.6 + 255 * 0.4, rgb[1] * 0.6 + 255 * 0.4, rgb[2] * 0.6];
        }
        const o = (py * VIEW_W + px) * 4;
        d[o] = rgb[0];
        d[o + 1] = rgb[1];
        d[o + 2] = rgb[2];
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    info.textContent =
      `semilla ${seed} · cámara (${camX}, ${camY}) · chunks cargados ${world.loadedCount} · ` +
      `WASD/flechas mover (Shift = rápido) · G cuadrícula · N semilla nueva`;
  }

  window.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 64 : 16;
    switch (e.key.toLowerCase()) {
      case 'arrowleft': case 'a': camX -= step; break;
      case 'arrowright': case 'd': camX += step; break;
      case 'arrowup': case 'w': camY -= step; break;
      case 'arrowdown': case 's': camY += step; break;
      case 'g': grid = !grid; break;
      case 'n':
        seed = Math.floor(Math.random() * 2 ** 31);
        gen = new WorldGenerator(seed);
        world = makeWorld(gen);
        break;
      default: return;
    }
    e.preventDefault();
    draw();
  });

  draw();
}