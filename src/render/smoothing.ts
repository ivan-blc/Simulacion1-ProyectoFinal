import { BLOCK_SIZE, BlockId, CHUNK_SIZE } from '../core/constants';
import { isSolidBlock } from '../core/blockInfo';

/** Lado de la rejilla de muestras: el chunk (32) + 1 bloque de margen por lado. */
export const SAMPLE_N = CHUNK_SIZE + 2;
/** Celdas por lado. Cada celda está entre cuatro centros de bloque. */
export const CELLS = SAMPLE_N - 1;
/** Lado (px) de la textura repetible de cada material. Debe dividir a CHUNK_SIZE * BLOCK_SIZE. */
export const TILE_PX = 32;

/** Material de cada capa, de abajo arriba (índice + 1 = rango). */
export const LAYER_BLOCK: readonly number[] = [
  BlockId.STONE,
  BlockId.DIRT,
  BlockId.GRASS,
  BlockId.COAL,
  BlockId.IRON,
  BlockId.GOLD,
];
export const LAYER_COUNT = LAYER_BLOCK.length;

/** Rango por id de bloque: 0 = aire (o desconocido). */
const RANK = new Uint8Array(256);
LAYER_BLOCK.forEach((id, k) => {
  RANK[id] = k + 1;
});

export function ranksFromSamples(samples: Uint8Array, out: Uint8Array): void {
  for (let i = 0; i < samples.length; i++) out[i] = RANK[samples[i]];
}

// Puntos de una celda (en unidades de bloque):
// 0 TL, 1 TR, 2 BR, 3 BL, 4 punto medio arriba, 5 derecha, 6 abajo, 7 izquierda
const PX = [0, 1, 1, 0, 0.5, 1, 0.5, 0];
const PY = [0, 0, 1, 1, 0, 0.5, 1, 0.5];

/**
 * Polígono sólido (convexo) de cada caso. Índice = TL*8 + TR*4 + BR*2 + BL.
 * Los casos 5 y 10 (esquinas opuestas) se resuelven UNIENDO las dos esquinas.
 */
export const CASES: ReadonlyArray<readonly number[]> = [
  [], //  0
  [3, 7, 6], //  1  BL
  [2, 6, 5], //  2  BR
  [7, 5, 2, 3], //  3  BR+BL
  [1, 5, 4], //  4  TR
  [7, 4, 1, 5, 6, 3], //  5  TR+BL (silla)
  [4, 1, 2, 6], //  6  TR+BR
  [7, 4, 1, 2, 3], //  7  todo menos TL
  [0, 4, 7], //  8  TL
  [0, 4, 6, 3], //  9  TL+BL
  [0, 4, 5, 2, 6, 7], // 10  TL+BR (silla)
  [0, 4, 5, 2, 3], // 11  todo menos TR
  [0, 1, 5, 7], // 12  TL+TR
  [0, 1, 5, 6, 3], // 13  todo menos BR
  [0, 1, 2, 6, 7], // 14  todo menos BL
  [0, 1, 2, 3], // 15  todo
];

/** Área de un caso en unidades de celda (1 = celda entera). */
export function caseArea(mask: number): number {
  const poly = CASES[mask];
  let a = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    a += PX[p] * PY[q] - PX[q] * PY[p];
  }
  return Math.abs(a) / 2;
}

/** Buffers de tamaño fijo de una capa. Se rellenan en sitio en cada reconstrucción. */
export class LayerBuffers {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  vertexCount = 0;
  indexCount = 0;

  constructor(maxCells: number) {
    // Peor caso por celda: un hexágono = 6 vértices y 4 triángulos
    this.positions = new Float32Array(maxCells * 6 * 2);
    this.uvs = new Float32Array(maxCells * 6 * 2);
    this.indices = new Uint32Array(maxCells * 12);
  }

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }
}

function emit(l: LayerBuffers, poly: readonly number[], ox: number, oy: number): void {
  const n = poly.length;
  if (n < 3) return;
  const base = l.vertexCount;
  for (let k = 0; k < n; k++) {
    const x = ox + PX[poly[k]] * BLOCK_SIZE;
    const y = oy + PY[poly[k]] * BLOCK_SIZE;
    const v = base + k;
    l.positions[v * 2] = x;
    l.positions[v * 2 + 1] = y;
    l.uvs[v * 2] = x / TILE_PX; // las UV salen de la posición: la textura es continua
    l.uvs[v * 2 + 1] = y / TILE_PX;
  }
  // Los polígonos son convexos: un abanico basta
  for (let k = 1; k < n - 1; k++) {
    l.indices[l.indexCount++] = base;
    l.indices[l.indexCount++] = base + k;
    l.indices[l.indexCount++] = base + k + 1;
  }
  l.vertexCount += n;
}

/**
 * Rellena las capas a partir de la rejilla de rangos (SAMPLE_N x SAMPLE_N).
 * La muestra (si, sj) es el bloque local (si - 1, sj - 1). Posiciones en píxeles del chunk.
 */
export function buildSmoothLayers(ranks: Uint8Array, layers: LayerBuffers[]): void {
  for (const l of layers) l.reset();
  const N = SAMPLE_N;

  for (let cj = 0; cj < CELLS; cj++) {
    for (let ci = 0; ci < CELLS; ci++) {
      const tl = ranks[cj * N + ci];
      const tr = ranks[cj * N + ci + 1];
      const bl = ranks[(cj + 1) * N + ci];
      const br = ranks[(cj + 1) * N + ci + 1];
      const top = Math.max(tl, tr, bl, br);
      if (top === 0) continue;

      // Origen de la celda: medio bloque antes del bloque (ci - 1)
      const ox = (ci - 0.5) * BLOCK_SIZE;
      const oy = (cj - 0.5) * BLOCK_SIZE;
      for (let r = 1; r <= top; r++) {
        const mask =
          (tl >= r ? 8 : 0) | (tr >= r ? 4 : 0) | (br >= r ? 2 : 0) | (bl >= r ? 1 : 0);
        emit(layers[r - 1], CASES[mask], ox, oy);
      }
    }
  }
  // Los triángulos sobrantes del buffer fijo quedan degenerados (0,0,0)
  for (const l of layers) l.indices.fill(0, l.indexCount);
}

/** Área total (px²) de los triángulos de una capa. Sirve para las pruebas. */
export function layerArea(l: LayerBuffers): number {
  const p = l.positions;
  let a = 0;
  for (let t = 0; t < l.indexCount; t += 3) {
    const i0 = l.indices[t] * 2;
    const i1 = l.indices[t + 1] * 2;
    const i2 = l.indices[t + 2] * 2;
    a += Math.abs((p[i1] - p[i0]) * (p[i2 + 1] - p[i0 + 1]) - (p[i2] - p[i0]) * (p[i1 + 1] - p[i0 + 1])) / 2;
  }
  return a;
}

/**
 * Fondo de cada celda: 1 = cielo, 0 = cueva. Es cielo si alguna esquina de AIRE de
 * la celda está sobre la superficie de su columna.
 * heights[si] = altura de superficie de la columna de la muestra si; firstBy = by de la fila 0.
 */
export function cellSkyMask(samples: Uint8Array, heights: ArrayLike<number>, firstBy: number): Uint8Array {
  const out = new Uint8Array(CELLS * CELLS);
  for (let cj = 0; cj < CELLS; cj++) {
    for (let ci = 0; ci < CELLS; ci++) {
      let sky = 0;
      for (let k = 0; k < 4; k++) {
        const si = ci + (k & 1);
        const sj = cj + (k >> 1);
        if (!isSolidBlock(samples[sj * SAMPLE_N + si]) && firstBy + sj < heights[si]) {
          sky = 1;
          break;
        }
      }
      out[cj * CELLS + ci] = sky;
    }
  }
  return out;
}