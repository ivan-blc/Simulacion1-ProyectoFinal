import { createNoise2D } from 'simplex-noise';
import { BlockId, CHUNK_SIZE } from '../core/constants';
import { hash2D, mulberry32 } from '../core/random';
import type { Chunk } from './Chunk';
import { GEN, ORES } from './genParams';
import { LIQUID } from './liquidParams';

const CAVE_SALT = 0x5bd1e995;
const DIRT_SALT = 7;
const PUDDLE_SALT = 0x2f6e2b1;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class WorldGenerator {
  readonly seed: number;
  private readonly noise: ReturnType<typeof createNoise2D>;

  constructor(seed: number) {
    this.seed = seed | 0;
    this.noise = createNoise2D(mulberry32(this.seed));
  }

  /** Altura de la superficie (coordenada Y del bloque de pasto) en la columna bx. */
  surfaceHeight(bx: number): number {
    let amp = 1;
    let freq = GEN.SURFACE_FREQ;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < GEN.SURFACE_OCTAVES; o++) {
      // el desplazamiento en Y distingue cada octava (ruido 1D sobre un plano 2D)
      sum += this.noise(bx * freq, o * 37.7) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return Math.floor(GEN.SURFACE_BASE + (sum / norm) * GEN.SURFACE_AMPLITUDE);
  }

  /** Mineral en (bx, by) o null. `depth` = bloques bajo la superficie de esa columna. */
  private oreAt(bx: number, by: number, depth: number): BlockId | null {
    for (const ore of ORES) {
      if (depth < ore.minDepth) continue;
      // El ruido es global y determinista: los filones no tienen costuras entre chunks
      const v = this.noise(bx * ore.freq + ore.offset, by * ore.freq + ore.offset * 0.7);
      if (v > ore.threshold) return ore.id;
    }
    return null;
  }

  /**
   * Devuelve un array w*h (1 = sólido, 0 = hueco) con el resultado de los
   * autómatas celulares para la región que empieza en el bloque (x0, y0).
   *
   * Calcula internamente una región con `pad` bloques extra por lado.
   * Cada iteración "contamina" 1 bloque desde el borde, así que con
   * pad >= iteraciones el interior es exacto, igual al de un mundo continuo.
   */
  caveSolidRegion(
    x0: number,
    y0: number,
    w: number,
    h: number,
    pad: number = GEN.CAVE_PAD,
  ): Uint8Array {
    const W = w + 2 * pad;
    const H = h + 2 * pad;
    const ox = x0 - pad;
    const oy = y0 - pad;

    let cur = new Uint8Array(W * H);
    let next = new Uint8Array(W * H);

    // 1) Relleno inicial: hash determinista con densidad según la profundidad
    for (let i = 0; i < W; i++) {
      const bx = ox + i;
      const surf = this.surfaceHeight(bx);
      for (let j = 0; j < H; j++) {
        const by = oy + j;
        const t = clamp01((by - surf - GEN.CAVE_MIN_DEPTH) / GEN.CAVE_RAMP);
        const solidChance = 1 - t * (1 - GEN.CAVE_SOLID_CHANCE);
        cur[j * W + i] = hash2D(bx, by, this.seed ^ CAVE_SALT) < solidChance ? 1 : 0;
      }
    }

    // 2) Autómatas celulares (fuera de la región se asume sólido)
    for (let it = 0; it < GEN.CAVE_ITERATIONS; it++) {
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          let n = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (di === 0 && dj === 0) continue;
              const ni = i + di;
              const nj = j + dj;
              if (ni < 0 || nj < 0 || ni >= W || nj >= H) n++;
              else n += cur[nj * W + ni];
            }
          }
          next[j * W + i] = n > 4 ? 1 : n < 4 ? 0 : cur[j * W + i];
        }
      }
      [cur, next] = [next, cur];
    }

    // 3) Extraer solo la región pedida (sin el margen)
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[y * w + x] = cur[(y + pad) * W + (x + pad)];
      }
    }
    return out;
  }

  /** Pipeline: superficie -> capas -> cuevas. Compatible con ChunkGenerator. */
  generateChunk(chunk: Chunk): void {
    const x0 = chunk.cx * CHUNK_SIZE;
    const y0 = chunk.cy * CHUNK_SIZE;
    const lastY = y0 + CHUNK_SIZE - 1;

    const heights = new Array<number>(CHUNK_SIZE);
    let minH = Infinity;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const h = this.surfaceHeight(x0 + lx);
      heights[lx] = h;
      if (h < minH) minH = h;
    }

    // Chunk completamente en el cielo: todo AIR (pero puede haber agua si queda bajo el nivel del mar)
    if (lastY < minH) {
      this.fillWater(chunk, heights);
      return;
    }

    // ¿Algún bloque del chunk está lo bastante hondo para tener cuevas?
    const needCaves = lastY - minH >= GEN.CAVE_MIN_DEPTH;
    const solid = needCaves
      ? this.caveSolidRegion(x0, y0, CHUNK_SIZE, CHUNK_SIZE)
      : null;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const bx = x0 + lx;
      const h = heights[lx];
      const dirtDepth =
        GEN.DIRT_MIN + Math.floor(hash2D(bx, 0, this.seed + DIRT_SALT) * (GEN.DIRT_VARIATION + 1));

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const by = y0 + ly;
        if (by < h) continue; // aire sobre la superficie

        let id: BlockId = by === h ? BlockId.GRASS : by <= h + dirtDepth ? BlockId.DIRT : BlockId.STONE;

        if (solid && by - h >= GEN.CAVE_MIN_DEPTH && solid[ly * CHUNK_SIZE + lx] === 0) {
          id = BlockId.AIR;
        }
        if (id === BlockId.STONE) {
          const ore = this.oreAt(bx, by, by - h);
          if (ore !== null) id = ore;
        }
        chunk.blocks[ly * CHUNK_SIZE + lx] = id;
      }
    }

    this.fillWater(chunk, heights);
    this.fillCavePuddles(chunk, heights);
  }

  /**
   * Lagos y mar: si la superficie de una columna queda más baja que WATER_LEVEL, el aire entre
   * ese nivel y el pasto se llena de agua. Es una regla por columna (no mira a los vecinos),
   * así que es determinista y no deja costuras entre chunks.
   */
  private fillWater(chunk: Chunk, heights: number[]): void {
    const y0 = chunk.cy * CHUNK_SIZE;
    const lastY = y0 + CHUNK_SIZE - 1;
    const top = Math.max(y0, GEN.WATER_LEVEL);
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const bottom = Math.min(lastY, heights[lx] - 1); // justo encima del pasto
      for (let by = top; by <= bottom; by++) {
        chunk.liquid[(by - y0) * CHUNK_SIZE + lx] = LIQUID.MAX_LEVEL;
      }
    }
  }

  /**
   * Charcos en las cuevas. Una CUENCA es un tramo horizontal de aire, con suelo sólido debajo de cada
   * celda y pared a ambos lados, dentro del chunk. Con probabilidad PUDDLE_CHANCE (decidida por un
   * hash de su posición) se llena con agua ya EN EQUILIBRIO: filas llenas abajo y una fila superior
   * uniforme. Así LiquidSim no tiene nada que mover, no hay que guardar nada y no hay costuras:
   * una cuenca que cruza el límite de un chunk no se siembra en ninguno de los dos.
   */
  private fillCavePuddles(chunk: Chunk, heights: number[]): void {
    const N = CHUNK_SIZE;
    const lastY = chunk.cy * N + N - 1;
    let minH = Infinity;
    for (const h of heights) if (h < minH) minH = h;
    if (lastY - minH < GEN.PUDDLE_MIN_DEPTH) return; // ni una sola celda está lo bastante honda

    const blocks = chunk.blocks;
    const isAir = (lx: number, ly: number): boolean => blocks[ly * N + lx] === BlockId.AIR;
    const isSolid = (lx: number, ly: number): boolean => blocks[ly * N + lx] !== BlockId.AIR;

    for (let ly = 0; ly < N - 1; ly++) { // la fila inferior no se mira: su suelo está en otro chunk
      let lx = 0;
      while (lx < N) {
        if (!isAir(lx, ly) || !isSolid(lx, ly + 1)) {
          lx++;
          continue;
        }
        let e = lx; // último bloque del tramo
        while (e + 1 < N && isAir(e + 1, ly) && isSolid(e + 1, ly + 1)) e++;
        const len = e - lx + 1;
        const walled = lx > 0 && e + 1 < N && isSolid(lx - 1, ly) && isSolid(e + 1, ly);
        if (walled && len >= 2 && len <= GEN.PUDDLE_MAX_WIDTH) {
          const bx = chunk.cx * N + lx;
          const by = chunk.cy * N + ly;
          if (by - heights[lx] >= GEN.PUDDLE_MIN_DEPTH && hash2D(bx, by, this.seed ^ PUDDLE_SALT) < GEN.PUDDLE_CHANCE) {
            this.fillBasin(chunk, lx, e, ly, bx, by);
          }
        }
        lx = e + 1;
      }
    }
  }

  /** Llena una cuenca [lx..e] cuyo suelo está en la fila `ly`: filas llenas abajo y una fila superior parcial uniforme. */
  private fillBasin(chunk: Chunk, lx: number, e: number, ly: number, bx: number, by: number): void {
    const N = CHUNK_SIZE;
    const blocks = chunk.blocks;
    // Cuántas filas están igual de encerradas (mismo ancho, aire y paredes a ambos lados)
    let rows = 1;
    while (rows < GEN.PUDDLE_MAX_ROWS) {
      const r = ly - rows;
      if (r < 0) break;
      let ok = blocks[r * N + lx - 1] !== BlockId.AIR && blocks[r * N + e + 1] !== BlockId.AIR;
      for (let x = lx; x <= e && ok; x++) if (blocks[r * N + x] !== BlockId.AIR) ok = false;
      if (!ok) break;
      rows++;
    }
    const used = 1 + Math.floor(hash2D(bx, by, (this.seed ^ PUDDLE_SALT) + 1) * rows); // 1..rows
    const topFill = 0.3 + 0.7 * hash2D(bx, by, (this.seed ^ PUDDLE_SALT) + 2); // nivel de la fila superior
    for (let k = 0; k < used; k++) {
      const level = k === used - 1 ? Math.round(LIQUID.MAX_LEVEL * topFill) : LIQUID.MAX_LEVEL;
      for (let x = lx; x <= e; x++) chunk.liquid[(ly - k) * N + x] = level;
    }
  }
}