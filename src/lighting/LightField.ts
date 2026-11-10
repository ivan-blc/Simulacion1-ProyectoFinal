import { BLOCK_INFO } from '../core/blockInfo';
import { CHUNK_SIZE } from '../core/constants';
import type { Chunk } from '../world/Chunk';

/** Oscuridad ambiental: nula hasta START bloques bajo la superficie, máxima a partir de START + RAMP. */
export const AMBIENT = { START: 6, RAMP: 30, MAX: 0.93 } as const;

/** Por debajo de este brillo una fuente no aporta nada a la celda (ahorra rayos). */
const MIN_BRIGHTNESS = 0.01;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Oscuridad ambiental (0..1) a `depth` bloques bajo la superficie de la columna. Por encima de la superficie es 0. */
export function ambientAtDepth(depth: number): number {
  return clamp01((depth - AMBIENT.START) / AMBIENT.RAMP) * AMBIENT.MAX;
}

// Tablas por id de bloque (se leen millones de veces por segundo)
const OPAQUE = new Float32Array(256);
const EMIT_RADIUS = new Float32Array(256);
const EMIT_INTENSITY = new Float32Array(256);
for (const [key, info] of Object.entries(BLOCK_INFO)) {
  const id = Number(key);
  OPAQUE[id] = info.solid ? 1 : 0;
  if (info.light) {
    EMIT_RADIUS[id] = info.light.radius;
    EMIT_INTENSITY[id] = info.light.intensity;
  }
}

export class LightField {
  readonly maxRadius: number;
  /** Margen (en bloques) alrededor de la rejilla visible donde se leen opacidades y fuentes. */
  readonly margin: number;

  // Rejilla visible, en coordenadas de bloque
  gx0 = 0;
  gy0 = 0;
  gw = 0;
  gh = 0;
  // Región ampliada con el margen
  ew = 0;
  eh = 0;

  /** Estadísticas de la última pasada. */
  lightsCast = 0;
  raysCast = 0;

  private opacity = new Float32Array(0);
  private unlitBuf = new Float32Array(0);
  /** Fuentes encontradas en los bloques: [bx, by, radio, intensidad] repetido. */
  private readonly emitters: number[] = [];

  constructor(maxRadius: number) {
    this.maxRadius = maxRadius;
    this.margin = Math.ceil(maxRadius) + 1;
  }

  /** Fracción de luz que NO llega a cada celda de la rejilla (1 = a oscuras, 0 = totalmente iluminada). */
  get unlit(): Float32Array {
    return this.unlitBuf;
  }

  /** Empieza una pasada nueva sobre la rejilla (gx0, gy0, gw, gh). Solo reserva memoria si cambia el tamaño. */
  begin(gx0: number, gy0: number, gw: number, gh: number): void {
    if (gw !== this.gw || gh !== this.gh) {
      this.gw = gw;
      this.gh = gh;
      this.ew = gw + 2 * this.margin;
      this.eh = gh + 2 * this.margin;
      this.opacity = new Float32Array(this.ew * this.eh);
      this.unlitBuf = new Float32Array(gw * gh);
    }
    this.gx0 = gx0;
    this.gy0 = gy0;
    this.unlitBuf.fill(1);
    this.emitters.length = 0;
    this.lightsCast = 0;
    this.raysCast = 0;
  }

  /**
   * Lee los bloques de la región ampliada: rellena la opacidad y recoge las fuentes de luz
   * (antorchas). Un chunk sin cargar cuenta como opaco.
   */
  scan(getChunk: (cx: number, cy: number) => Chunk | undefined): void {
    const ex0 = this.gx0 - this.margin;
    const ey0 = this.gy0 - this.margin;

    for (let j = 0; j < this.eh; j++) {
      const by = ey0 + j;
      const cy = Math.floor(by / CHUNK_SIZE);
      const ly = by - cy * CHUNK_SIZE;
      let curCx = Number.NaN;
      let blocks: Uint8Array | null = null;

      for (let i = 0; i < this.ew; i++) {
        const bx = ex0 + i;
        const cx = Math.floor(bx / CHUNK_SIZE);
        if (cx !== curCx) {
          curCx = cx;
          const chunk = getChunk(cx, cy);
          blocks = chunk ? chunk.blocks : null;
        }
        if (!blocks) {
          this.opacity[j * this.ew + i] = 1;
          continue;
        }
        const id = blocks[ly * CHUNK_SIZE + (bx - cx * CHUNK_SIZE)];
        this.opacity[j * this.ew + i] = OPAQUE[id];
        if (EMIT_RADIUS[id] > 0) this.emitters.push(bx, by, EMIT_RADIUS[id], EMIT_INTENSITY[id]);
      }
    }
  }

  /**
   * Hace que un rectángulo (en unidades de bloque) absorba luz: así los enemigos
   * proyectan sombra. Se queda con la opacidad más alta de cada celda.
   */
  stampRect(left: number, top: number, right: number, bottom: number, opacity: number): void {
    const ex0 = this.gx0 - this.margin;
    const ey0 = this.gy0 - this.margin;
    const x0 = Math.max(Math.floor(left), ex0);
    const x1 = Math.min(Math.ceil(right) - 1, ex0 + this.ew - 1);
    const y0 = Math.max(Math.floor(top), ey0);
    const y1 = Math.min(Math.ceil(bottom) - 1, ey0 + this.eh - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y - ey0) * this.ew + (x - ex0);
        if (opacity > this.opacity[i]) this.opacity[i] = opacity;
      }
    }
  }

  /** Suma la luz de todas las antorchas encontradas por scan(), con parpadeo. `time` en segundos. */
  addBlockLights(time: number): void {
    const e = this.emitters;
    for (let k = 0; k < e.length; k += 4) {
      const bx = e[k];
      const by = e[k + 1];
      const phase = bx * 0.754 + by * 1.318; // cada antorcha parpadea con su propia fase
      const flicker = 1 + 0.05 * Math.sin(time * 7 + phase) + 0.025 * Math.sin(time * 17.3 + phase * 1.7);
      this.addLight(bx + 0.5, by + 0.4, e[k + 2] * flicker, e[k + 3]);
    }
  }

  /**
   * Añade una fuente en (sx, sy), en bloques con decimales. Para cada celda de la rejilla dentro del
   * radio traza un rayo hasta su centro y acumula la opacidad de lo que atraviesa.
   */
  addLight(sx: number, sy: number, radius: number, intensity: number): void {
    const r = Math.min(radius, this.maxRadius);
    if (r <= 0 || intensity <= 0) return;

    // La fuente debe estar dentro de la región ampliada, o sus rayos saldrían de lo que conocemos
    const ex0 = this.gx0 - this.margin;
    const ey0 = this.gy0 - this.margin;
    const scx = Math.floor(sx);
    const scy = Math.floor(sy);
    if (scx < ex0 || scy < ey0 || scx >= ex0 + this.ew || scy >= ey0 + this.eh) return;
    this.lightsCast++;

    const x0 = Math.max(this.gx0, Math.floor(sx - r));
    const x1 = Math.min(this.gx0 + this.gw - 1, Math.floor(sx + r));
    const y0 = Math.max(this.gy0, Math.floor(sy - r));
    const y1 = Math.min(this.gy0 + this.gh - 1, Math.floor(sy + r));
    const r2 = r * r;

    for (let ty = y0; ty <= y1; ty++) {
      const dy = ty + 0.5 - sy;
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - sx;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;

        // Caída suave: smoothstep de (1 - distancia/radio), con núcleo casi pleno y borde sin escalón
        const a = 1 - Math.sqrt(d2) / r;
        const b = intensity * a * a * (3 - 2 * a);
        if (b < MIN_BRIGHTNESS) continue;

        this.raysCast++;
        const tr = this.transmittance(sx, sy, tx, ty);
        if (tr <= 0) continue;
        this.unlitBuf[(ty - this.gy0) * this.gw + (tx - this.gx0)] *= 1 - b * tr;
      }
    }
  }

  /** Brillo (0..1) de una celda de la rejilla tras sumar todas las luces. Fuera de la rejilla es 0. */
  brightnessAt(bx: number, by: number): number {
    const i = bx - this.gx0;
    const j = by - this.gy0;
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return 0;
    return 1 - this.unlitBuf[j * this.gw + i];
  }

  /**
   * Rayo desde (sx, sy) hasta el centro de la celda (tx, ty), recorriendo las celdas con DDA.
   * Devuelve qué fracción de luz sobrevive: el producto de (1 - opacidad) de las celdas intermedias.
   * La celda de origen y la de destino no cuentan, así la cara iluminada de un muro sí recibe luz.
   */
  private transmittance(sx: number, sy: number, tx: number, ty: number): number {
    let cx = Math.floor(sx);
    let cy = Math.floor(sy);
    if (cx === tx && cy === ty) return 1;

    const dx = tx + 0.5 - sx;
    const dy = ty + 0.5 - sy;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    // Parámetro t del segmento (0..1) en el que se cruza el siguiente borde vertical / horizontal
    const tDeltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
    const tDeltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
    let tMaxX = dx === 0 ? Infinity : (dx > 0 ? cx + 1 - sx : sx - cx) * tDeltaX;
    let tMaxY = dy === 0 ? Infinity : (dy > 0 ? cy + 1 - sy : sy - cy) * tDeltaY;

    let tr = 1;
    for (;;) {
      // Solo se avanza por un eje que aún no ha llegado al destino: el bucle siempre termina
      if (cx !== tx && (cy === ty || tMaxX < tMaxY)) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
      if (cx === tx && cy === ty) return tr;
      tr *= 1 - this.opacityAt(cx, cy);
      if (tr <= 0.001) return 0;
    }
  }

  private opacityAt(cx: number, cy: number): number {
    const i = cx - (this.gx0 - this.margin);
    const j = cy - (this.gy0 - this.margin);
    if (i < 0 || j < 0 || i >= this.ew || j >= this.eh) return 1;
    return this.opacity[j * this.ew + i];
  }
}