import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import { BLOCK_SIZE, BlockId } from '../core/constants';
import { blockToChunkCoord, worldToBlockCoord } from '../core/coords';
import type { WorldManager } from '../world/WorldManager';

export interface BlockEditorOptions {
  canvas: HTMLCanvasElement;
  worldContainer: Container;
  world: WorldManager;
}

const PLACEABLE: BlockId[] = [BlockId.DIRT, BlockId.STONE, BlockId.GRASS];

export class BlockEditor {
  /** Añádelo al worldContainer, encima de los chunks. */
  readonly cursor = new Graphics();
  selected: BlockId = BlockId.DIRT;
  hoverX = 0;
  hoverY = 0;

  /** Si es true, solo se puede construir junto a un bloque sólido (estilo Terraria). */
  requireSupport = false;
  /** Hook para la Fase 5: alcance máximo y no construir dentro del jugador. */
  canEdit: (bx: number, by: number, placing: boolean) => boolean = () => true;

  private readonly canvas: HTMLCanvasElement;
  private readonly worldContainer: Container;
  private readonly world: WorldManager;

  private sx = 0;
  private sy = 0;
  private buttons = 0;
  private inside = false;
  private last: { x: number; y: number } | null = null;

  constructor(opts: BlockEditorOptions) {
    this.canvas = opts.canvas;
    this.worldContainer = opts.worldContainer;
    this.world = opts.world;

    this.cursor.rect(0, 0, BLOCK_SIZE, BLOCK_SIZE).stroke({ width: 1, color: 0xffffff, alpha: 0.9 });
    this.cursor.visible = false;

    const track = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.sx = e.clientX - r.left;
      this.sy = e.clientY - r.top;
      this.buttons = e.buttons;
      this.inside = true;
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.last = null; // la línea de arrastre empieza en el clic
      track(e);
    });
    this.canvas.addEventListener('pointermove', track);
    this.canvas.addEventListener('pointerleave', () => {
      this.inside = false;
    });
    // Soltar fuera del canvas también cuenta
    window.addEventListener('pointerup', (e) => {
      this.buttons = e.buttons;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= PLACEABLE.length) this.selected = PLACEABLE[n - 1];
    });
  }

  /** Llamar una vez por frame, DESPUÉS de camera.apply(). */
  update(): void {
    this.cursor.visible = this.inside;
    if (!this.inside) {
      this.last = null;
      return;
    }

    // Pantalla -> mundo usando posición y escala del contenedor, que camera.apply()
    // acaba de fijar (más fiable que toLocal, cuya matriz global se actualiza al renderizar).
    const wc = this.worldContainer;
    const bx = worldToBlockCoord((this.sx - wc.x) / wc.scale.x);
    const by = worldToBlockCoord((this.sy - wc.y) / wc.scale.y);
    this.hoverX = bx;
    this.hoverY = by;
    this.cursor.position.set(bx * BLOCK_SIZE, by * BLOCK_SIZE);

    const mining = (this.buttons & 1) !== 0;
    const placing = !mining && (this.buttons & 2) !== 0;
    if (mining || placing) {
      const from = this.last ?? { x: bx, y: by };
      this.applyLine(from.x, from.y, bx, by, placing);
      this.last = { x: bx, y: by };
    } else {
      this.last = null;
    }
  }

  /** Recorre los bloques entre dos puntos para que el arrastre rápido no deje huecos. */
  private applyLine(x0: number, y0: number, x1: number, y1: number, placing: boolean): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      this.applyAt(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), placing);
    }
  }

  private applyAt(bx: number, by: number, placing: boolean): void {
    // Nunca editar donde el chunk no está cargado: getBlock devolvería AIR falso
    if (!this.world.getChunk(blockToChunkCoord(bx), blockToChunkCoord(by))) return;
    if (!this.canEdit(bx, by, placing)) return;

    const current = this.world.getBlock(bx, by);
    if (placing) {
      if (current !== BlockId.AIR) return;
      if (this.requireSupport && !this.hasSupport(bx, by)) return;
      this.world.setBlock(bx, by, this.selected);
    } else {
      if (current === BlockId.AIR) return;
      this.world.setBlock(bx, by, BlockId.AIR);
    }
  }

  private hasSupport(bx: number, by: number): boolean {
    return (
      this.world.getBlock(bx - 1, by) !== BlockId.AIR ||
      this.world.getBlock(bx + 1, by) !== BlockId.AIR ||
      this.world.getBlock(bx, by - 1) !== BlockId.AIR ||
      this.world.getBlock(bx, by + 1) !== BlockId.AIR
    );
  }
}