import { ambientAtDepth } from './LightField';
import type { LightField } from './LightField';

/**
 * Suaviza `data` (w x h) con un filtro [1 2 1]/4 separable, `passes` veces.
 * Los bordes se replican. `tmp` debe tener al menos w * h elementos.
 */
export function blurInPlace(data: Float32Array, tmp: Float32Array, w: number, h: number, passes: number): void {
  for (let p = 0; p < passes; p++) {
    // Horizontal: data -> tmp
    for (let j = 0; j < h; j++) {
      const row = j * w;
      for (let i = 0; i < w; i++) {
        const l = data[row + (i > 0 ? i - 1 : 0)];
        const r = data[row + (i < w - 1 ? i + 1 : w - 1)];
        tmp[row + i] = (l + 2 * data[row + i] + r) * 0.25;
      }
    }
    // Vertical: tmp -> data
    for (let j = 0; j < h; j++) {
      const row = j * w;
      const up = (j > 0 ? j - 1 : 0) * w;
      const dn = (j < h - 1 ? j + 1 : h - 1) * w;
      for (let i = 0; i < w; i++) {
        data[row + i] = (tmp[up + i] + 2 * tmp[row + i] + tmp[dn + i]) * 0.25;
      }
    }
  }
}

/** Oscuridad final (0 = claro, 1 = negro) de cada muestra del campo de luz. */
export class DarknessMap {
  data = new Float32Array(0);
  w = 0;
  h = 0;

  private tmp = new Float32Array(0);
  private colSurf = new Float32Array(0);

  /**
   * surf[i] = altura de la superficie en la columna i de la rejilla de bloques (length = field.gw).
   * La oscuridad de cada muestra es la ambiental (según su profundidad) por la fracción de luz que no llega.
   */
  update(field: LightField, surf: ArrayLike<number>, blurPasses: number): void {
    const { sw, sh, scale, gw, gy0 } = field;
    if (sw !== this.w || sh !== this.h) {
      this.w = sw;
      this.h = sh;
      this.data = new Float32Array(sw * sh);
      this.tmp = new Float32Array(sw * sh);
      this.colSurf = new Float32Array(sw);
    }

    // Altura de superficie interpolada entre columnas: así la oscuridad ambiental no avanza a escalones
    for (let i = 0; i < sw; i++) {
      const x = (i + 0.5) / scale - 0.5; // en unidades de columna (el centro de la columna c está en c)
      if (x <= 0) this.colSurf[i] = surf[0];
      else if (x >= gw - 1) this.colSurf[i] = surf[gw - 1];
      else {
        const c = Math.floor(x);
        const t = x - c;
        this.colSurf[i] = surf[c] * (1 - t) + surf[c + 1] * t;
      }
    }

    const unlit = field.unlit;
    for (let j = 0; j < sh; j++) {
      const by = gy0 + (j + 0.5) / scale;
      for (let i = 0; i < sw; i++) {
        const k = j * sw + i;
        this.data[k] = ambientAtDepth(by - this.colSurf[i]) * unlit[k];
      }
    }

    blurInPlace(this.data, this.tmp, sw, sh, blurPasses);
  }
}