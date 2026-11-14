import { isSolidBlock } from '../core/blockInfo';
import { CHUNK_SIZE } from '../core/constants';
import { CASES, PX, PY } from '../render/smoothing';
import type { Chunk } from '../world/Chunk';
import type { WorldManager } from '../world/WorldManager';
import { CELL_PX, CHUNK_MASK, CHUNK_PIX, CHUNK_SHIFT, HALF, PPB, PixelMat } from './materials';
import type { FluidSensor } from './materials';

export interface SimParams {
  enabled: boolean;
  /** Ticks de simulación por segundo. */
  tickRate: number;
  /** Celdas que cae un píxel por tick. */
  fallCells: number;
  /** Celdas que mira el agua en horizontal buscando un desnivel. */
  waterReach: number;
  lavaReach: number;
  /** La lava se mueve cada N ticks (1..4): a mayor valor, más viscosa. */
  lavaEvery: number;
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  enabled: true,
  tickRate: 30,
  fallCells: 3,
  waterReach: 12,
  lavaReach: 3,
  lavaEvery: 2,
};

const CELLS = CHUNK_PIX * CHUNK_PIX;
/** Valor que devuelve probe() para terreno sólido o chunk sin cargar. */
const SOLID = 255;
const SINK_CHANCE = 0.6; // probabilidad por tick de hundirse un nivel en un líquido
const REACT_CHANCE = 0.5; // probabilidad por tick de que agua y lava en contacto se anulen
const SLEEP_TICKS = 6; // ticks sin movimiento antes de dormir (debe ser > lavaEvery máximo)
const MAX_TICKS_PER_UPDATE = 3;
const LAVA_LIGHT_MIN = 6; // celdas de lava (de 64) para que un bloque emita luz
const LAVA_REFRESH_TICKS = 8;

const ckey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

// ---------------------------------------------------------------- colisión suavizada

/**
 * Para cada uno de los 16 casos de marching squares, un bitmap PPB x PPB que indica qué celdas de píxel
 * quedan dentro del polígono sólido. Son los mismos polígonos que dibuja el render.
 */
const CASE_BITS: Uint8Array = (() => {
  const out = new Uint8Array(16 * PPB * PPB);
  for (let m = 1; m < 16; m++) {
    const poly = CASES[m];
    let area2 = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      area2 += PX[a] * PY[b] - PX[b] * PY[a];
    }
    const sign = area2 >= 0 ? 1 : -1;
    for (let v = 0; v < PPB; v++) {
      for (let u = 0; u < PPB; u++) {
        const x = (u + 0.5) / PPB;
        const y = (v + 0.5) / PPB;
        let inside = true;
        for (let k = 0; k < poly.length && inside; k++) {
          const a = poly[k];
          const b = poly[(k + 1) % poly.length];
          const cross = (PX[b] - PX[a]) * (y - PY[a]) - (PY[b] - PY[a]) * (x - PX[a]);
          if (cross * sign < -1e-9) inside = false; // el borde cuenta como sólido
        }
        out[m * PPB * PPB + v * PPB + u] = inside ? 1 : 0;
      }
    }
  }
  return out;
})();

export class PixelLayer {
  readonly cx: number;
  readonly cy: number;
  readonly cells = new Uint8Array(CELLS);
  /** Marca de tick en que se movió cada celda (evita mover dos veces el mismo píxel en un tick). */
  readonly moved = new Uint8Array(CELLS);
  count = 0;
  lavaCount = 0;
  sleep = false;
  idle = 0;
  renderDirty = true;
  version = 0;
  // Caja que contiene todos los píxeles: solo se escanea esa zona
  minX = CHUNK_PIX;
  maxX = -1;
  minY = CHUNK_PIX;
  maxY = -1;
  // Bloques de la superficie de la lava, en coordenadas de bloque [bx, by, ...]
  lavaSpots: number[] = [];
  lavaStamp = -1;
  lavaTick = -1000;

  constructor(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
  }
}

export class PixelSim implements FluidSensor {
  readonly params: SimParams = { ...DEFAULT_SIM_PARAMS };
  readonly layers = new Map<number, PixelLayer>();
  /** Máximo de capas en memoria; las de chunks descargados se descartan al superarlo. */
  maxLayers = 96;

  ticks = 0;
  /** Píxeles que se movieron en el último tick. */
  moves = 0;
  activeLayers = 0;
  tickMs = 0;

  /** El agua y la lava se anulan en esta celda (a lo sumo una vez por tick). */
  onReact?: (px: number, py: number) => void;

  private readonly world: WorldManager;
  private readonly rand: () => number;
  private readonly colls = new Map<number, { data: Uint8Array; dirty: boolean }>();
  private readonly solidTmp = new Uint8Array((CHUNK_SIZE + 2) * (CHUNK_SIZE + 2));
  private readonly blockCounts = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private acc = 0;
  private stamp = 0;
  private reacted = false;

  // Caché de la última capa y mapa de colisión consultados
  private pcx = Number.NaN;
  private pcy = Number.NaN;
  private pColl: Uint8Array | null = null;
  private pLayer: PixelLayer | undefined;

  constructor(world: WorldManager, rand: () => number = Math.random) {
    this.world = world;
    this.rand = rand;
  }

  get totalPixels(): number {
    let n = 0;
    for (const l of this.layers.values()) n += l.count;
    return n;
  }

  // ------------------------------------------------------------ reloj

  /** Avanza el reloj de la simulación. Llamar una vez por frame. */
  update(dt: number): void {
    if (!this.params.enabled) return;
    const interval = 1 / Math.max(1, this.params.tickRate);
    this.acc = Math.min(this.acc + dt, interval * MAX_TICKS_PER_UPDATE);
    while (this.acc >= interval) {
      this.acc -= interval;
      this.step();
    }
  }

  /** Un tick de simulación (público para las pruebas). */
  step(): void {
    const t0 = performance.now();
    this.ticks++;
    this.stamp = (this.stamp % 255) + 1;
    this.resetProbe();
    this.reacted = false;

    const ltr = (this.ticks & 1) === 0;
    const work: PixelLayer[] = [];
    for (const l of this.layers.values()) {
      if (!l.sleep && this.world.getChunk(l.cx, l.cy)) work.push(l);
    }
    // De abajo arriba, para que lo que cae a la capa de abajo ya se haya procesado
    work.sort((a, b) => b.cy - a.cy || (ltr ? a.cx - b.cx : b.cx - a.cx));
    this.activeLayers = work.length;

    let total = 0;
    for (const l of work) {
      const n = this.stepLayer(l, ltr);
      total += n;
      if (n > 0) {
        l.idle = 0;
        this.wakeNeighbors(l);
      } else if (++l.idle >= SLEEP_TICKS) {
        l.sleep = true;
      }
    }
    this.moves = total;
    this.evict();
    this.tickMs = performance.now() - t0;
  }

  // ------------------------------------------------------------ eventos del mundo

  onChunkLoaded(chunk: Chunk): void {
    this.invalidateAround(chunk.cx, chunk.cy, -1, 1, -1, 1);
  }

  onChunkUnloaded(chunk: Chunk): void {
    this.colls.delete(ckey(chunk.cx, chunk.cy));
    this.invalidateAround(chunk.cx, chunk.cy, -1, 1, -1, 1);
    this.resetProbe();
  }

  /** Un bloque cambió: la colisión de su chunk (y de los vecinos, si está en un borde) ya no vale. Enlazar con world.onBlockChanged. */
  onBlockChanged(bx: number, by: number): void {
    const cx = Math.floor(bx / CHUNK_SIZE);
    const cy = Math.floor(by / CHUNK_SIZE);
    const lx = bx - cx * CHUNK_SIZE;
    const ly = by - cy * CHUNK_SIZE;
    this.invalidateAround(
      cx,
      cy,
      lx === 0 ? -1 : 0,
      lx === CHUNK_SIZE - 1 ? 1 : 0,
      ly === 0 ? -1 : 0,
      ly === CHUNK_SIZE - 1 ? 1 : 0,
    );
  }

  /** Borra todos los píxeles y mapas de colisión (por ejemplo, al regenerar el terreno). */
  clearAll(): void {
    this.layers.clear();
    this.colls.clear();
    this.resetProbe();
  }

  // ------------------------------------------------------------ API pública

  /** Lee la celda (x, y) de la rejilla global de píxeles (0 = vacía). */
  peek(x: number, y: number): number {
    const l = this.layers.get(ckey(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT));
    return l ? l.cells[((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK)] : 0;
  }

  /** ¿Es sólida la celda según el terreno suavizado? Un chunk sin cargar cuenta como sólido. */
  isSolidCell(x: number, y: number): boolean {
    this.resetProbe();
    return this.probe(x, y) === SOLID;
  }

  /**
   * Coloca un píxel en (x, y). Si la celda está ocupada usa la libre más cercana por encima.
   * Devuelve false si no hay sitio o el terreno no está cargado.
   */
  deposit(x: number, y: number, mat: number): boolean {
    this.resetProbe();
    for (let dy = 0; dy <= 6; dy++) {
      if (this.probe(x, y - dy) === 0) {
        this.write(x, y - dy, mat);
        return true;
      }
    }
    for (const dx of [-1, 1, -2, 2]) {
      if (this.probe(x + dx, y) === 0) {
        this.write(x + dx, y, mat);
        return true;
      }
    }
    return false;
  }

  /** Rellena un rectángulo de celdas (inclusive) con un material, solo donde hay hueco. Devuelve cuántas rellenó. */
  fillRect(x0: number, y0: number, x1: number, y1: number, mat: number): number {
    this.resetProbe();
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.probe(x, y) === 0) {
          this.write(x, y, mat);
          n++;
        }
      }
    }
    return n;
  }

  /** Fracción de celdas del rectángulo (px del mundo) que contienen `mat`. */
  fraction(x: number, y: number, w: number, h: number, mat: number): number {
    const x0 = Math.floor(x / CELL_PX);
    const x1 = Math.floor((x + w - 0.001) / CELL_PX);
    const y0 = Math.floor(y / CELL_PX);
    const y1 = Math.floor((y + h - 0.001) / CELL_PX);
    let hit = 0;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) if (this.peek(px, py) === mat) hit++;
    }
    return hit / ((x1 - x0 + 1) * (y1 - y0 + 1));
  }

  countMaterial(mat: number): number {
    let n = 0;
    for (const l of this.layers.values()) for (let i = 0; i < l.cells.length; i++) if (l.cells[i] === mat) n++;
    return n;
  }

  /** Elimina los píxeles de un cuadrado de radio `radius` bloques alrededor del bloque (bx, by). Devuelve cuántos borró. */
  clearArea(bx: number, by: number, radius: number): number {
    const x0 = (bx - radius) * PPB;
    const x1 = (bx + radius + 1) * PPB - 1;
    const y0 = (by - radius) * PPB;
    const y1 = (by + radius + 1) * PPB - 1;
    let n = 0;
    for (const l of this.layers.values()) {
      const ox = l.cx * CHUNK_PIX;
      const oy = l.cy * CHUNK_PIX;
      const lx0 = Math.max(0, x0 - ox);
      const lx1 = Math.min(CHUNK_PIX - 1, x1 - ox);
      const ly0 = Math.max(0, y0 - oy);
      const ly1 = Math.min(CHUNK_PIX - 1, y1 - oy);
      if (lx0 > lx1 || ly0 > ly1) continue;
      for (let ly = ly0; ly <= ly1; ly++) {
        for (let lx = lx0; lx <= lx1; lx++) {
          if (l.cells[(ly << CHUNK_SHIFT) | lx] !== 0) {
            this.write(ox + lx, oy + ly, 0);
            n++;
          }
        }
      }
      l.sleep = false;
      l.idle = 0;
    }
    return n;
  }

  /**
   * Llama a `cb` por cada bloque de la superficie de un lago de lava dentro del rango (en bloques).
   * Sirve para iluminar. Devuelve cuántos encontró (hasta `max`).
   */
  collectLava(
    bx0: number,
    by0: number,
    bx1: number,
    by1: number,
    cb: (bx: number, by: number) => void,
    max: number,
  ): number {
    let n = 0;
    for (const l of this.layers.values()) {
      if (l.lavaCount <= 0) continue;
      const cbx = l.cx * CHUNK_SIZE;
      const cby = l.cy * CHUNK_SIZE;
      if (cbx > bx1 || cbx + CHUNK_SIZE - 1 < bx0 || cby > by1 || cby + CHUNK_SIZE - 1 < by0) continue;
      if (l.lavaStamp !== l.version && this.ticks - l.lavaTick >= LAVA_REFRESH_TICKS) this.refreshLavaSpots(l);
      for (let k = 0; k < l.lavaSpots.length; k += 2) {
        const bx = l.lavaSpots[k];
        const by = l.lavaSpots[k + 1];
        if (bx < bx0 || bx > bx1 || by < by0 || by > by1) continue;
        cb(bx, by);
        if (++n >= max) return n;
      }
    }
    return n;
  }

  // ------------------------------------------------------------ capas y colisión

  private resetProbe(): void {
    this.pcx = Number.NaN;
    this.pcy = Number.NaN;
  }

  private invalidateAround(cx: number, cy: number, dx0: number, dx1: number, dy0: number, dy1: number): void {
    for (let dy = dy0; dy <= dy1; dy++) {
      for (let dx = dx0; dx <= dx1; dx++) {
        const k = ckey(cx + dx, cy + dy);
        const c = this.colls.get(k);
        if (c) c.dirty = true;
        const l = this.layers.get(k);
        if (l) {
          l.sleep = false;
          l.idle = 0;
        }
      }
    }
  }

  /** Mapa de colisión (1 = sólido) de un chunk, recalculado si hace falta. null si el chunk no está cargado. */
  private collisionFor(cx: number, cy: number): Uint8Array | null {
    const k = ckey(cx, cy);
    let c = this.colls.get(k);
    if (c && !c.dirty) return c.data;
    if (!this.world.getChunk(cx, cy)) return null;
    if (!c) {
      c = { data: new Uint8Array(CELLS), dirty: true };
      this.colls.set(k, c);
    }
    this.computeCollision(cx, cy, c.data);
    c.dirty = false;
    return c.data;
  }

  /** Rasteriza los polígonos de marching squares del chunk a la rejilla de píxeles. */
  private computeCollision(cx: number, cy: number, out: Uint8Array): void {
    const S = CHUNK_SIZE + 2;
    const sol = this.solidTmp;
    const self = this.world.getChunk(cx, cy);
    const bx0 = cx * CHUNK_SIZE - 1;
    const by0 = cy * CHUNK_SIZE - 1;

    // Solidez de los bloques del chunk y de un anillo de 1 bloque alrededor (los chunks sin cargar cuentan como sólidos)
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        let solid: number;
        if (self && i >= 1 && i <= CHUNK_SIZE && j >= 1 && j <= CHUNK_SIZE) {
          solid = isSolidBlock(self.blocks[(j - 1) * CHUNK_SIZE + (i - 1)]) ? 1 : 0;
        } else {
          const bx = bx0 + i;
          const by = by0 + j;
          const ncx = Math.floor(bx / CHUNK_SIZE);
          const ncy = Math.floor(by / CHUNK_SIZE);
          const nb = this.world.getChunk(ncx, ncy);
          solid = nb
            ? isSolidBlock(nb.blocks[(by - ncy * CHUNK_SIZE) * CHUNK_SIZE + (bx - ncx * CHUNK_SIZE)])
              ? 1
              : 0
            : 1;
        }
        sol[j * S + i] = solid;
      }
    }

    // Cada celda de marching squares está entre cuatro centros de bloque: empieza HALF píxeles después del bloque
    for (let cj = -1; cj < CHUNK_SIZE; cj++) {
      for (let ci = -1; ci < CHUNK_SIZE; ci++) {
        const tl = sol[(cj + 1) * S + ci + 1];
        const tr = sol[(cj + 1) * S + ci + 2];
        const bl = sol[(cj + 2) * S + ci + 1];
        const br = sol[(cj + 2) * S + ci + 2];
        const table = ((tl << 3) | (tr << 2) | (br << 1) | bl) * PPB * PPB;
        const ox = ci * PPB + HALF;
        const oy = cj * PPB + HALF;
        for (let v = 0; v < PPB; v++) {
          const y = oy + v;
          if (y < 0 || y >= CHUNK_PIX) continue;
          for (let u = 0; u < PPB; u++) {
            const x = ox + u;
            if (x < 0 || x >= CHUNK_PIX) continue;
            out[y * CHUNK_PIX + x] = CASE_BITS[table + v * PPB + u];
          }
        }
      }
    }
  }

  /** 0 = libre, SOLID = terreno (o chunk sin cargar), 1..3 = material que ocupa la celda. */
  private probe(x: number, y: number): number {
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    if (cx !== this.pcx || cy !== this.pcy) {
      this.pcx = cx;
      this.pcy = cy;
      this.pColl = this.collisionFor(cx, cy);
      this.pLayer = this.layers.get(ckey(cx, cy));
    }
    if (!this.pColl) return SOLID;
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    if (this.pColl[i] !== 0) return SOLID;
    return this.pLayer ? this.pLayer.cells[i] : 0;
  }

  /** Escribe una celda, creando la capa si hace falta y llevando las cuentas. `mark` la marca como movida en este tick. */
  private write(x: number, y: number, v: number, mark = false): void {
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    let l = this.layers.get(ckey(cx, cy));
    if (!l) {
      if (v === 0) return;
      l = new PixelLayer(cx, cy);
      this.layers.set(ckey(cx, cy), l);
      if (cx === this.pcx && cy === this.pcy) this.pLayer = l;
    }
    const lx = x & CHUNK_MASK;
    const ly = y & CHUNK_MASK;
    const i = (ly << CHUNK_SHIFT) | lx;
    const old = l.cells[i];
    if (old === v) {
      if (mark) l.moved[i] = this.stamp;
      return;
    }
    l.cells[i] = v;
    l.version++;
    l.renderDirty = true;
    if (old === 0) l.count++;
    else if (v === 0) l.count--;
    if (old === PixelMat.LAVA) l.lavaCount--;
    if (v === PixelMat.LAVA) l.lavaCount++;
    if (v !== 0) {
      if (lx < l.minX) l.minX = lx;
      if (lx > l.maxX) l.maxX = lx;
      if (ly < l.minY) l.minY = ly;
      if (ly > l.maxY) l.maxY = ly;
      l.sleep = false;
      l.idle = 0;
      if (mark) l.moved[i] = this.stamp;
    }
  }

  private move(fx: number, fy: number, tx: number, ty: number, v: number): void {
    this.write(tx, ty, v, true);
    this.write(fx, fy, 0);
  }

  private wakeNeighbors(l: PixelLayer): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const n = this.layers.get(ckey(l.cx + dx, l.cy + dy));
        if (n) {
          n.sleep = false;
          n.idle = 0;
        }
      }
    }
  }

  private evict(): void {
    for (const [k, l] of this.layers) if (l.count === 0) this.layers.delete(k);
    if (this.layers.size > this.maxLayers) {
      for (const [k, l] of this.layers) {
        if (this.layers.size <= this.maxLayers) break;
        if (!this.world.getChunk(l.cx, l.cy)) this.layers.delete(k);
      }
    }
    this.resetProbe();
  }

  private refreshLavaSpots(l: PixelLayer): void {
    const counts = this.blockCounts;
    counts.fill(0);
    const y1 = Math.min(CHUNK_PIX - 1, l.maxY);
    const x1 = Math.min(CHUNK_PIX - 1, l.maxX);
    for (let ly = Math.max(0, l.minY); ly <= y1; ly++) {
      for (let lx = Math.max(0, l.minX); lx <= x1; lx++) {
        if (l.cells[(ly << CHUNK_SHIFT) | lx] === PixelMat.LAVA) {
          counts[Math.floor(ly / PPB) * CHUNK_SIZE + Math.floor(lx / PPB)]++;
        }
      }
    }
    // Emite el bloque que tiene lava y no tiene lava encima: la superficie del lago
    const spots: number[] = [];
    for (let j = 0; j < CHUNK_SIZE; j++) {
      for (let i = 0; i < CHUNK_SIZE; i++) {
        if (counts[j * CHUNK_SIZE + i] < LAVA_LIGHT_MIN) continue;
        if (j > 0 && counts[(j - 1) * CHUNK_SIZE + i] >= LAVA_LIGHT_MIN) continue;
        spots.push(l.cx * CHUNK_SIZE + i, l.cy * CHUNK_SIZE + j);
      }
    }
    l.lavaSpots = spots;
    l.lavaStamp = l.version;
    l.lavaTick = this.ticks;
  }

  // ------------------------------------------------------------ recorrido

  private stepLayer(l: PixelLayer, ltr: boolean): number {
    const coll = this.collisionFor(l.cx, l.cy);
    if (!coll || l.maxY < 0) return 0;

    // La caja de píxeles se reconstruye durante el recorrido: las escrituras y las celdas visitadas la amplían
    const minX = l.minX;
    const maxX = l.maxX;
    const minY = l.minY;
    const maxY = l.maxY;
    l.minX = CHUNK_PIX;
    l.maxX = -1;
    l.minY = CHUNK_PIX;
    l.maxY = -1;

    const x0 = l.cx * CHUNK_PIX;
    const y0 = l.cy * CHUNK_PIX;
    const cells = l.cells;
    const moved = l.moved;
    const stamp = this.stamp;
    const lavaEvery = Math.max(1, Math.round(this.params.lavaEvery));
    const lavaTurn = this.ticks % lavaEvery === 0;
    let active = 0;

    for (let ly = maxY; ly >= minY; ly--) {
      // La dirección alterna por fila y por tick: sin sesgo lateral
      const rowLtr = ltr !== ((ly & 1) === 1);
      for (let n = minX; n <= maxX; n++) {
        const lx = rowLtr ? n : maxX - (n - minX);
        const i = (ly << CHUNK_SHIFT) | lx;
        const m = cells[i];
        if (m === 0) continue;
        if (coll[i] !== 0) {
          this.write(x0 + lx, y0 + ly, 0); // un bloque se colocó sobre el píxel
          continue;
        }
        if (lx < l.minX) l.minX = lx;
        if (lx > l.maxX) l.maxX = lx;
        if (ly < l.minY) l.minY = ly;
        if (ly > l.maxY) l.maxY = ly;
        if (moved[i] === stamp) continue; // ya se movió en este tick
        if (m === PixelMat.LAVA && !lavaTurn) continue;

        const moving =
          m === PixelMat.SAND ? this.stepSand(x0 + lx, y0 + ly) : this.stepLiquid(x0 + lx, y0 + ly, m);
        if (moving) active++;
      }
    }
    return active;
  }

  private fallDistance(x: number, y: number): number {
    // Llamar con la celda (x, y + 1) ya comprobada como libre: devuelve hasta dónde cae
    const fall = Math.max(1, Math.round(this.params.fallCells));
    let ny = y + 1;
    for (let k = 1; k < fall && this.probe(x, ny + 1) === 0; k++) ny++;
    return ny;
  }

  private stepSand(x: number, y: number): boolean {
    const below = this.probe(x, y + 1);
    if (below === 0) {
      this.move(x, y, x, this.fallDistance(x, y), PixelMat.SAND);
      return true;
    }
    if (below === PixelMat.WATER || below === PixelMat.LAVA) {
      // La arena es más densa: se hunde intercambiando posición con el líquido
      if (this.rand() < SINK_CHANCE) {
        this.write(x, y + 1, PixelMat.SAND, true);
        this.write(x, y, below, true);
      }
      return true;
    }
    // Resbala en diagonal si tanto el hueco de al lado como el de debajo están libres
    const first = this.rand() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const d = k === 0 ? first : -first;
      if (this.probe(x + d, y) === 0 && this.probe(x + d, y + 1) === 0) {
        this.move(x, y, x + d, y + 1, PixelMat.SAND);
        return true;
      }
    }
    return false;
  }

  private stepLiquid(x: number, y: number, mat: number): boolean {
    if (this.reactNeighbors(x, y, mat)) return true;
    if (this.probe(x, y + 1) === 0) {
      this.move(x, y, x, this.fallDistance(x, y), mat);
      return true;
    }
    const first = this.rand() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const d = k === 0 ? first : -first;
      if (this.probe(x + d, y) === 0 && this.probe(x + d, y + 1) === 0) {
        this.move(x, y, x + d, y + 1, mat);
        return true;
      }
    }
    const reach = Math.max(1, Math.round(mat === PixelMat.LAVA ? this.params.lavaReach : this.params.waterReach));
    return this.spread(x, y, mat, reach);
  }

  /**
   * Busca por la fila el desnivel más cercano (una celda libre con hueco debajo) hasta `reach` celdas y va hacia él.
   * Solo se mueve hacia un desnivel: cada movimiento baja la energía del conjunto, así que el líquido siempre se
   * detiene (y la capa se duerme), y la superficie queda plana con una pendiente máxima de 1 celda por `reach`.
   */
  private spread(x: number, y: number, mat: number, reach: number): boolean {
    const first = this.rand() < 0.5 ? -1 : 1;
    let bestDir = 0;
    let bestK = reach + 1;
    for (let n = 0; n < 2; n++) {
      const dir = n === 0 ? first : -first;
      for (let k = 1; k <= reach && k < bestK; k++) {
        if (this.probe(x + dir * k, y) !== 0) break; // un obstáculo corta el camino
        if (this.probe(x + dir * k, y + 1) === 0) {
          bestDir = dir;
          bestK = k;
          break;
        }
      }
    }
    if (bestDir === 0) return false;
    this.move(x, y, x + bestDir * bestK, y, mat); // llega al borde del desnivel y cae en el siguiente tick
    return true;
  }

  /** Agua junto a lava: se anulan. */
  private reactNeighbors(x: number, y: number, mat: number): boolean {
    if (mat === PixelMat.SAND) return false;
    const other = mat === PixelMat.LAVA ? PixelMat.WATER : PixelMat.LAVA;
    const dxs = [0, 0, -1, 1];
    const dys = [1, -1, 0, 0];
    for (let d = 0; d < 4; d++) {
      if (this.probe(x + dxs[d], y + dys[d]) !== other) continue;
      if (this.rand() >= REACT_CHANCE) continue;
      this.write(x, y, 0);
      this.write(x + dxs[d], y + dys[d], 0);
      if (!this.reacted) {
        this.reacted = true;
        this.onReact?.(x, y);
      }
      return true;
    }
    return false;
  }
}