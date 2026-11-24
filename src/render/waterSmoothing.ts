/**
 * Geometría del agua suavizada (ver docs/MEJORAS_AGUA.md). Módulo puro: no importa Pixi, así que
 * se puede probar en src/dev/tests.ts.
 *
 * Idea: el agua de cada celda del marching squares del terreno es la región `φ >= 0` de un campo
 * escalar, recortada con la parte de AIRE de esa misma celda. Así el agua nunca se solapa con el
 * terreno suavizado y su borde coincide con el suyo.
 *
 * `φ` es la distancia vertical (en bloques) de un centro de bloque a la superficie del agua:
 * positiva dentro del agua y negativa por encima.
 */
import { isSolidBlock } from '../core/blockInfo';
import { CHUNK_SIZE } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import { LIQUID } from '../world/liquidParams';
import { CASES, PX, PY } from './smoothing';

/** Bloques de margen alrededor del chunk que hacen falta para calcular φ y las celdas en caída. */
export const WATER_MARGIN = 3;
export const WATER_GRID = CHUNK_SIZE + 2 * WATER_MARGIN;
/** Muestras de φ: una por cada esquina de celda (0..CHUNK_SIZE en cada eje). */
const PHI_N = CHUNK_SIZE + 1;
/** φ se limita a este valor (lejos de la superficie no importa cuánto vale). */
export const PHI_MAX = 1;
/** Grosor de la banda clara de la superficie, en bloques (2 px con bloques de 16 px). */
export const BAND_THICKNESS = 0.125;
export const STRIP_MIN_PX = 3;
export const STRIP_MAX_PX = 12;

/** ¿Está el agua de esta celda cayendo? Hay agua, abajo no hay bloque y la celda de abajo no está llena. */
export function isFallingCell(level: number, belowBlocked: boolean, belowLevel: number): boolean {
  return level > 0 && !belowBlocked && belowLevel < LIQUID.MAX_LEVEL;
}

/** Ancho en píxeles de la tira que representa una celda en caída: de 3 a 12, proporcional al nivel. */
export function stripWidthPx(level: number): number {
  return STRIP_MIN_PX + (STRIP_MAX_PX - STRIP_MIN_PX) * Math.min(1, level / (LIQUID.MAX_LEVEL / 2));
}

// ---------------------------------------------------------------------------------------------
// Partes de aire de cada máscara de sólido
// ---------------------------------------------------------------------------------------------

interface Piece {
  pts: number[]; // [x0, y0, x1, y1, ...] en coordenadas de celda (0..1)
  n: number;
  orient: number; // signo del área con signo
}

function makePiece(idx: readonly number[]): Piece {
  const pts: number[] = [];
  for (const i of idx) pts.push(PX[i], PY[i]);
  const n = idx.length;
  let a = 0;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    a += pts[2 * k] * pts[2 * j + 1] - pts[2 * j] * pts[2 * k + 1];
  }
  return { pts, n, orient: a >= 0 ? 1 : -1 };
}

/**
 * Máscara: TL*8 + TR*4 + BR*2 + BL (1 = sólido). El aire es el complemento del polígono de sólido de
 * CASES; en las sillas (5 y 10) el terreno une las dos esquinas, así que el aire son DOS triángulos.
 */
const AIR_PIECES: Piece[][] = (() => {
  const table: Piece[][] = [];
  for (let m = 0; m < 16; m++) {
    if (m === 0) table.push([makePiece([0, 1, 2, 3])]);
    else if (m === 15) table.push([]);
    else if (m === 5) table.push([makePiece(CASES[8]), makePiece(CASES[2])]);
    else if (m === 10) table.push([makePiece(CASES[4]), makePiece(CASES[1])]);
    else table.push([makePiece(CASES[15 - m])]);
  }
  return table;
})();

/** Área del aire de una celda con esa máscara (la del sólido es `caseArea(mask)`). */
export function airArea(mask: number): number {
  let total = 0;
  for (const p of AIR_PIECES[mask]) total += Math.abs(polyArea(p.pts, p.n));
  return total;
}

function polyArea(pts: ArrayLike<number>, n: number): number {
  let a = 0;
  for (let k = 0; k < n; k++) {
    const j = k + 1 === n ? 0 : k + 1;
    a += pts[2 * k] * pts[2 * j + 1] - pts[2 * j] * pts[2 * k + 1];
  }
  return a / 2;
}

// ---------------------------------------------------------------------------------------------
// Recorte convexo (Sutherland–Hodgman) con buffers reutilizados
// ---------------------------------------------------------------------------------------------

const EPS = 1e-12;
const bufA = new Float64Array(64);
const bufB = new Float64Array(64);

/** Recorta `subject` (convexo, n puntos) con el convexo `clip`. Escribe el resultado en `out` y devuelve su nº de puntos. */
function clipConvex(subject: ArrayLike<number>, ns: number, clip: Piece, out: Float64Array): number {
  const c = clip.pts;
  const orient = clip.orient;
  let src: ArrayLike<number> = subject;
  let n = ns;
  let dst = bufA;
  for (let e = 0; e < clip.n && n > 0; e++) {
    const f = e + 1 === clip.n ? 0 : e + 1;
    const ax = c[2 * e];
    const ay = c[2 * e + 1];
    const dx = c[2 * f] - ax;
    const dy = c[2 * f + 1] - ay;
    let m = 0;
    let px = src[2 * (n - 1)];
    let py = src[2 * (n - 1) + 1];
    let sp = orient * (dx * (py - ay) - dy * (px - ax));
    for (let j = 0; j < n; j++) {
      const cx = src[2 * j];
      const cy = src[2 * j + 1];
      const sc = orient * (dx * (cy - ay) - dy * (cx - ax));
      if (sc >= -EPS) {
        if (sp < -EPS) {
          const t = sp / (sp - sc);
          dst[2 * m] = px + (cx - px) * t;
          dst[2 * m + 1] = py + (cy - py) * t;
          m++;
        }
        dst[2 * m] = cx;
        dst[2 * m + 1] = cy;
        m++;
      } else if (sp >= -EPS) {
        const t = sp / (sp - sc);
        dst[2 * m] = px + (cx - px) * t;
        dst[2 * m + 1] = py + (cy - py) * t;
        m++;
      }
      px = cx;
      py = cy;
      sp = sc;
    }
    src = dst;
    n = m;
    dst = dst === bufA ? bufB : bufA;
  }
  for (let k = 0; k < 2 * n; k++) out[k] = src[k];
  return n;
}

// ---------------------------------------------------------------------------------------------
// Región { valor >= 0 } de una celda (marching squares con vértices interpolados)
// ---------------------------------------------------------------------------------------------

const CORNER_X = [0, 1, 1, 0];
const CORNER_Y = [0, 0, 1, 1];
/** Cada arista se recorre SIEMPRE de arriba abajo o de izquierda a derecha, para que dos celdas vecinas calculen el mismo punto. */
const EDGE_FROM = [0, 1, 3, 0]; // top: TL→TR, right: TR→BR, bottom: BL→BR, left: TL→BL
const EDGE_TO = [1, 2, 2, 3];

/** Escribe en `out` el polígono de {v >= 0} (recorrido TL, TR, BR, BL) y devuelve su nº de puntos. */
function insideRegion(v0: number, v1: number, v2: number, v3: number, out: Float64Array): number {
  if (v0 >= 0 && v1 >= 0 && v2 >= 0 && v3 >= 0) {
    out[0] = 0; out[1] = 0; out[2] = 1; out[3] = 0; out[4] = 1; out[5] = 1; out[6] = 0; out[7] = 1;
    return 4;
  }
  const v = [v0, v1, v2, v3];
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) & 3;
    if (v[k] >= 0) {
      out[2 * n] = CORNER_X[k];
      out[2 * n + 1] = CORNER_Y[k];
      n++;
    }
    if (v[k] >= 0 !== v[k2] >= 0) {
      // arista k: (k, k2) salvo la última, que es (3, 0) = la izquierda recorrida al revés
      const edge = k === 3 ? 3 : k === 2 ? 2 : k;
      const a = EDGE_FROM[edge];
      const b = EDGE_TO[edge];
      const t = v[a] / (v[a] - v[b]);
      out[2 * n] = CORNER_X[a] + (CORNER_X[b] - CORNER_X[a]) * t;
      out[2 * n + 1] = CORNER_Y[a] + (CORNER_Y[b] - CORNER_Y[a]) * t;
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Rejilla local de un chunk con su margen
// ---------------------------------------------------------------------------------------------

/**
 * Datos del agua alrededor de un chunk: nivel efectivo (0..1), bloques sólidos y celdas en caída.
 * Las coordenadas locales van de -WATER_MARGIN a CHUNK_SIZE + WATER_MARGIN - 1.
 */
export class WaterGrid {
  /** Nivel efectivo 0..1: las celdas en caída cuentan como 0 (se dibujan aparte, como tiras). */
  readonly fill = new Float32Array(WATER_GRID * WATER_GRID);
  /** Nivel crudo (0..MAX_LEVEL). */
  readonly level = new Uint16Array(WATER_GRID * WATER_GRID);
  readonly solid = new Uint8Array(WATER_GRID * WATER_GRID);
  /** 1 si el chunk de esa celda está cargado. */
  readonly known = new Uint8Array(WATER_GRID * WATER_GRID);
  readonly falling = new Uint8Array(WATER_GRID * WATER_GRID);
  /** true si hay agua en algún punto de la rejilla (si no, no hay nada que dibujar). */
  anyWater = false;
  private readonly phi = new Float32Array(PHI_N * PHI_N);

  static index(lx: number, ly: number): number {
    return (ly + WATER_MARGIN) * WATER_GRID + (lx + WATER_MARGIN);
  }

  /** Rellena la rejilla del chunk (cx, cy) con sus 8 vecinos. Un vecino sin cargar cuenta como aire sin agua. */
  load(cx: number, cy: number, getChunk: (cx: number, cy: number) => Chunk | undefined): void {
    const N = WATER_GRID;
    this.level.fill(0);
    this.solid.fill(0);
    this.known.fill(0);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = getChunk(cx + dx, cy + dy);
        if (!chunk) continue;
        const gx0 = Math.max(-WATER_MARGIN, dx * CHUNK_SIZE);
        const gx1 = Math.min(CHUNK_SIZE + WATER_MARGIN - 1, dx * CHUNK_SIZE + CHUNK_SIZE - 1);
        const gy0 = Math.max(-WATER_MARGIN, dy * CHUNK_SIZE);
        const gy1 = Math.min(CHUNK_SIZE + WATER_MARGIN - 1, dy * CHUNK_SIZE + CHUNK_SIZE - 1);
        for (let gy = gy0; gy <= gy1; gy++) {
          const ly = gy - dy * CHUNK_SIZE;
          for (let gx = gx0; gx <= gx1; gx++) {
            const lx = gx - dx * CHUNK_SIZE;
            const src = ly * CHUNK_SIZE + lx;
            const i = (gy + WATER_MARGIN) * N + (gx + WATER_MARGIN);
            this.level[i] = chunk.liquid[src];
            this.solid[i] = isSolidBlock(chunk.blocks[src]) ? 1 : 0;
            this.known[i] = 1;
          }
        }
      }
    }
    // Celdas en caída: hay agua y abajo no hay bloque (un chunk sin cargar actúa como pared) ni agua llena
    const MAX = LIQUID.MAX_LEVEL;
    this.falling.fill(0);
    this.fill.fill(0);
    this.anyWater = false;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const level = this.level[k];
        if (level === 0) continue;
        this.anyWater = true;
        let fall = false;
        if (j + 1 < N) {
          const b = k + N;
          const blocked = this.solid[b] === 1 || this.known[b] === 0;
          fall = isFallingCell(level, blocked, this.level[b]);
        }
        this.falling[k] = fall ? 1 : 0;
        this.fill[k] = fall ? 0 : level / MAX;
      }
    }
  }

  /** φ de un bloque (índice de la rejilla) o NaN si no hay agua a la vista. No mira bloques sólidos. */
  private blockPhi(k: number): number {
    const N = WATER_GRID;
    const f = this.fill[k];
    if (f > 0) {
      const above = this.fill[k - N];
      if (above <= 0) return f - 0.5; // la superficie está dentro de este bloque
      if (this.fill[k - 2 * N] <= 0) return Math.min(PHI_MAX, 0.5 + above); // la superficie está en el bloque de arriba
      return PHI_MAX; // bastante por debajo de la superficie
    }
    const below = this.fill[k + N];
    if (below > 0) return below - 1.5; // bloque seco justo encima de la superficie
    return NaN;
  }

  /** φ de una muestra: los bloques sólidos prolongan la superficie de sus vecinos laterales. */
  private samplePhi(k: number): number {
    let p: number;
    if (this.solid[k] === 0) {
      p = this.blockPhi(k);
    } else {
      const a = this.solid[k - 1] === 0 ? this.blockPhi(k - 1) : NaN;
      const b = this.solid[k + 1] === 0 ? this.blockPhi(k + 1) : NaN;
      p = a === a && b === b ? (a + b) / 2 : a === a ? a : b;
    }
    return p === p ? p : -1; // sin agua cerca: seco
  }

  /** Calcula φ en las (CHUNK_SIZE + 1)² esquinas de celda. */
  computePhi(): Float32Array {
    for (let ly = 0; ly < PHI_N; ly++) {
      for (let lx = 0; lx < PHI_N; lx++) {
        this.phi[ly * PHI_N + lx] = this.samplePhi((ly + WATER_MARGIN) * WATER_GRID + (lx + WATER_MARGIN));
      }
    }
    return this.phi;
  }
}

// ---------------------------------------------------------------------------------------------
// Construcción de la geometría de un chunk
// ---------------------------------------------------------------------------------------------

export interface WaterSink {
  /** Polígono convexo en coordenadas de celda (0..1). (lx, ly) es el bloque de la esquina superior izquierda de la celda. */
  polygon(pts: Float64Array, n: number, lx: number, ly: number, band: boolean): void;
  /** Una celda en caída, para dibujarla como tira vertical. */
  strip(lx: number, ly: number, level: number): void;
}

const polyW = new Float64Array(32);
const polyB = new Float64Array(32);
const polyC = new Float64Array(32);
const polyOut = new Float64Array(32);

/**
 * Recorre las celdas de marching squares que pertenecen al chunk (las que tienen su esquina superior
 * izquierda en el chunk) y entrega al `sink` los polígonos de agua, la banda clara de la superficie
 * y las tiras de las celdas en caída. Cada celda pertenece a un solo chunk, así que no hay solapes.
 */
export function buildWaterGeometry(grid: WaterGrid, sink: WaterSink, withBand = true): void {
  const phi = grid.computePhi();
  const N = WATER_GRID;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      // Tira de la celda en caída
      const own = (ly + WATER_MARGIN) * N + (lx + WATER_MARGIN);
      if (grid.falling[own] === 1) sink.strip(lx, ly, grid.level[own]);

      const p0 = phi[ly * PHI_N + lx];
      const p1 = phi[ly * PHI_N + lx + 1];
      const p2 = phi[(ly + 1) * PHI_N + lx + 1];
      const p3 = phi[(ly + 1) * PHI_N + lx];
      if (p0 < 0 && p1 < 0 && p2 < 0 && p3 < 0) continue;

      const k0 = own;
      const mask =
        (grid.solid[k0] << 3) | (grid.solid[k0 + 1] << 2) | (grid.solid[k0 + N + 1] << 1) | grid.solid[k0 + N];
      if (mask === 15) continue;
      const pieces = AIR_PIECES[mask];

      const nw = insideRegion(p0, p1, p2, p3, polyW);
      if (nw < 3) continue;

      // Cuerpo: región de agua ∩ aire
      for (let pi = 0; pi < pieces.length; pi++) {
        let n: number;
        if (mask === 0) {
          for (let k = 0; k < 2 * nw; k++) polyOut[k] = polyW[k];
          n = nw;
        } else {
          n = clipConvex(polyW, nw, pieces[pi], polyOut);
        }
        if (n >= 3 && Math.abs(polyArea(polyOut, n)) > 1e-9) sink.polygon(polyOut, n, lx, ly, false);
      }

      // Banda clara: región de agua con φ <= BAND_THICKNESS (cerca de la superficie)
      if (withBand && (p0 <= BAND_THICKNESS || p1 <= BAND_THICKNESS || p2 <= BAND_THICKNESS || p3 <= BAND_THICKNESS)) {
        const nb = insideRegion(BAND_THICKNESS - p0, BAND_THICKNESS - p1, BAND_THICKNESS - p2, BAND_THICKNESS - p3, polyB);
        if (nb < 3) continue;
        const wPiece: Piece = { pts: Array.from(polyW.subarray(0, 2 * nw)), n: nw, orient: 1 };
        const nc = clipConvex(polyB, nb, wPiece, polyC);
        if (nc < 3) continue;
        for (let pi = 0; pi < pieces.length; pi++) {
          let n: number;
          if (mask === 0) {
            for (let k = 0; k < 2 * nc; k++) polyOut[k] = polyC[k];
            n = nc;
          } else {
            n = clipConvex(polyC, nc, pieces[pi], polyOut);
          }
          if (n >= 3 && Math.abs(polyArea(polyOut, n)) > 1e-9) sink.polygon(polyOut, n, lx, ly, true);
        }
      }
    }
  }
}

/** Utilidad para pruebas: polígonos de agua de UNA celda dados sus 4 valores de φ y su máscara de sólido. */
export function waterCellPolygons(phi: [number, number, number, number], mask: number): number[][] {
  const out: number[][] = [];
  if (mask === 15 || (phi[0] < 0 && phi[1] < 0 && phi[2] < 0 && phi[3] < 0)) return out;
  const nw = insideRegion(phi[0], phi[1], phi[2], phi[3], polyW);
  if (nw < 3) return out;
  const pieces = AIR_PIECES[mask];
  for (let pi = 0; pi < pieces.length; pi++) {
    let n: number;
    if (mask === 0) {
      for (let k = 0; k < 2 * nw; k++) polyOut[k] = polyW[k];
      n = nw;
    } else {
      n = clipConvex(polyW, nw, pieces[pi], polyOut);
    }
    if (n >= 3 && Math.abs(polyArea(polyOut, n)) > 1e-9) out.push(Array.from(polyOut.subarray(0, 2 * n)));
  }
  return out;
}

/** Área de un polígono plano [x0, y0, x1, y1, ...] (valor absoluto). */
export function flatPolygonArea(pts: ArrayLike<number>): number {
  return Math.abs(polyArea(pts, pts.length / 2));
}
