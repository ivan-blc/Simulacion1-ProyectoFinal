import { CHUNK_SIZE } from '../core/constants';
import { blockToChunkCoord, blockToLocalCoord } from '../core/coords';
import type { Chunk } from './Chunk';
import { LIQUID } from './liquidParams';
import type { WorldManager } from './WorldManager';

const DIRS_A = [-1, 1] as const;
const DIRS_B = [1, -1] as const;

/**
 * Agua como autómata celular por niveles (0..LIQUID.MAX_LEVEL por celda).
 *
 * Reglas, por celda despierta y en este orden:
 *  1. caer: si abajo no hay un bloque sólido y la celda no está llena, se le pasa agua.
 *  2. repartirse: si ya no puede caer más, iguala el nivel con las vecinas laterales.
 *  3. evaporar: una capa muy fina sobre suelo sólido desaparece.
 *  4. dormir: si no se movió nada, la celda deja de costar tiempo.
 *
 * Solo se procesan las celdas "despiertas": las que recibieron agua, las que tienen cerca un
 * bloque que cambió o las de un chunk recién cargado. Un lago en reposo no cuesta nada.
 * Los chunks sin cargar actúan como una pared (su agua queda congelada).
 */
export class LiquidSim {
  /** Estadísticas del último tick (para el panel de depuración). */
  readonly stats = { awake: 0, processed: 0, ms: 0, ticks: 0 };

  private readonly world: WorldManager;
  private acc = 0;
  private tickNo = 0;
  private readonly active: Chunk[] = [];

  constructor(world: WorldManager) {
    this.world = world;
  }

  /** Avanza la simulación con pasos fijos de 1 / TICK_HZ segundos. */
  update(dt: number): void {
    const step = 1 / LIQUID.TICK_HZ;
    this.acc = Math.min(this.acc + dt, LIQUID.MAX_TICKS_PER_FRAME * step);
    while (this.acc >= step) {
      this.acc -= step;
      for (let s = 0; s < LIQUID.SUBSTEPS; s++) this.tick();
    }
  }

  /** Un chunk se cargó: despertar su agua y la de los bordes de sus vecinos. */
  onChunkLoaded(chunk: Chunk): void {
    for (let i = 0; i < chunk.liquid.length; i++) this.wakeIndex(chunk, i);

    const last = CHUNK_SIZE - 1;
    for (let k = 0; k < CHUNK_SIZE; k++) {
      this.wakeEdge(chunk.cx - 1, chunk.cy, last, k); // vecino de la izquierda: su columna derecha
      this.wakeEdge(chunk.cx + 1, chunk.cy, 0, k); // vecino de la derecha: su columna izquierda
      this.wakeEdge(chunk.cx, chunk.cy - 1, k, last); // vecino de arriba: su fila inferior
      this.wakeEdge(chunk.cx, chunk.cy + 1, k, 0); // vecino de abajo: su fila superior
    }
  }

  /** Cambió un bloque (minado o colocado): el agua reacciona. */
  onBlockChanged(bx: number, by: number): void {
    const w = this.world;
    const level = w.getLiquid(bx, by);
    if (level > 0 && w.isLiquidBlocked(bx, by)) {
      // Se colocó un sólido sobre agua: el agua desplazada sube a la celda de arriba si cabe; si no, se pierde
      w.addLiquid(bx, by, -level);
      const up = w.getLiquid(bx, by - 1);
      if (up >= 0 && !w.isLiquidBlocked(bx, by - 1)) {
        const room = Math.min(level, LIQUID.MAX_LEVEL - up);
        if (room > 0) w.addLiquid(bx, by - 1, room);
      }
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) this.wake(bx + dx, by + dy);
    }
  }

  private tick(): void {
    const t0 = performance.now();
    const parity = this.tickNo++ & 1;
    let budget = LIQUID.CELL_BUDGET;

    this.active.length = 0;
    this.world.forEachChunk((c) => {
      if (c.awakeCount > 0) this.active.push(c);
    });
    this.active.sort((a, b) => b.cy - a.cy); // de abajo hacia arriba

    for (const chunk of this.active) {
      for (let ly = CHUNK_SIZE - 1; ly >= 0 && budget > 0; ly--) {
        for (let k = 0; k < CHUNK_SIZE && budget > 0; k++) {
          const lx = parity ? k : CHUNK_SIZE - 1 - k; // el sentido del escaneo alterna cada tick
          if (chunk.awake[ly * CHUNK_SIZE + lx] === 0) continue;
          budget--;
          this.stepCell(chunk, lx, ly, parity);
        }
      }
    }

    let awake = 0;
    for (const chunk of this.active) awake += chunk.awakeCount;
    this.stats.awake = awake;
    this.stats.processed = LIQUID.CELL_BUDGET - budget;
    this.stats.ms = performance.now() - t0;
    this.stats.ticks++;
  }

  private stepCell(chunk: Chunk, lx: number, ly: number, parity: number): void {
    const w = this.world;
    const MAX = LIQUID.MAX_LEVEL;
    const bx = chunk.cx * CHUNK_SIZE + lx;
    const by = chunk.cy * CHUNK_SIZE + ly;
    let level = chunk.liquid[ly * CHUNK_SIZE + lx];
    if (level === 0) {
      this.sleep(chunk, lx, ly);
      return;
    }

    let moved = false;
    const belowBlocked = w.isLiquidBlocked(bx, by + 1);

    // 1) Caer
    if (!belowBlocked) {
      const below = w.getLiquid(bx, by + 1);
      if (below < MAX) {
        const f = Math.min(level, MAX - below);
        this.transfer(bx, by, bx, by + 1, f);
        level -= f;
        moved = true;
      }
    }

    // 2) Repartirse hacia los lados (solo si ya no puede caer más)
    if (level > 0 && (belowBlocked || w.getLiquid(bx, by + 1) >= MAX)) {
      for (const d of parity ? DIRS_A : DIRS_B) {
        if (w.isLiquidBlocked(bx + d, by)) continue;
        const diff = level - w.getLiquid(bx + d, by);
        if (diff >= LIQUID.MIN_DIFF) {
          const f = (diff + 1) >> 1;
          this.transfer(bx, by, bx + d, by, f);
          level -= f;
          moved = true;
        }
      }
    }

    // 3) Evaporar o dormir
    if (!moved) {
      if (level <= LIQUID.EVAPORATE_LEVEL && belowBlocked) {
        w.addLiquid(bx, by, -level);
        this.wakeCross(bx, by - 1); // el agua de arriba, si la hay, puede caer ahora
      } else {
        this.sleep(chunk, lx, ly);
      }
    }
  }

  /** Pasa `f` unidades de agua de A a B y despierta lo que puede reaccionar. */
  private transfer(ax: number, ay: number, bx: number, by: number, f: number): void {
    this.world.addLiquid(ax, ay, -f);
    this.world.addLiquid(bx, by, f);
    this.wakeCross(bx, by);
    this.wakeCross(ax, ay - 1);
    this.wakeCross(ax - 1, ay);
    this.wakeCross(ax + 1, ay);
  }

  /** Despierta (bx, by) y sus 4 vecinas (las que tengan agua). */
  private wakeCross(bx: number, by: number): void {
    this.wake(bx, by);
    this.wake(bx - 1, by);
    this.wake(bx + 1, by);
    this.wake(bx, by - 1);
    this.wake(bx, by + 1);
  }

  private wake(bx: number, by: number): void {
    const chunk = this.world.getChunk(blockToChunkCoord(bx), blockToChunkCoord(by));
    if (!chunk) return;
    this.wakeIndex(chunk, blockToLocalCoord(by) * CHUNK_SIZE + blockToLocalCoord(bx));
  }

  private wakeEdge(cx: number, cy: number, lx: number, ly: number): void {
    const chunk = this.world.getChunk(cx, cy);
    if (chunk) this.wakeIndex(chunk, ly * CHUNK_SIZE + lx);
  }

  private wakeIndex(chunk: Chunk, i: number): void {
    if (chunk.liquid[i] > 0 && chunk.awake[i] === 0) {
      chunk.awake[i] = 1;
      chunk.awakeCount++;
    }
  }

  private sleep(chunk: Chunk, lx: number, ly: number): void {
    const i = ly * CHUNK_SIZE + lx;
    if (chunk.awake[i] === 1) {
      chunk.awake[i] = 0;
      chunk.awakeCount--;
    }
  }
}
