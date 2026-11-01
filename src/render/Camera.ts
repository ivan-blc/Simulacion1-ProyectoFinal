import type { Container } from 'pixi.js';

export interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class Camera {
  /** Centro de la cámara en píxeles del mundo. */
  x = 0;
  y = 0;
  /** Solo valores enteros: evita costuras entre chunks y mantiene el pixel art nítido. */
  zoom = 2;

  private readonly target: Container;

  constructor(target: Container) {
    this.target = target;
  }

  setZoom(z: number): void {
    this.zoom = Math.min(4, Math.max(1, Math.round(z)));
  }

  /** Mueve el contenedor del mundo en sentido opuesto a la cámara. */
  apply(screenW: number, screenH: number): void {
    this.target.scale.set(this.zoom);
    this.target.position.set(
      Math.round(screenW / 2 - this.x * this.zoom),
      Math.round(screenH / 2 - this.y * this.zoom),
    );
  }

  /** Rectángulo del mundo visible en pantalla. */
  bounds(screenW: number, screenH: number): WorldRect {
    const hw = screenW / 2 / this.zoom;
    const hh = screenH / 2 / this.zoom;
    return {
      left: this.x - hw,
      right: this.x + hw,
      top: this.y - hh,
      bottom: this.y + hh,
    };
  }
}