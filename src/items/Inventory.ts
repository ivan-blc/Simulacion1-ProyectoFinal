import { BLOCK_INFO } from '../core/blockInfo';
import type { BlockId } from '../core/constants';

export interface Slot {
  id: BlockId;
  count: number;
}

export const HOTBAR_SIZE = 10;
export const MAX_STACK = 999;

export class Inventory {
  readonly slots: Array<Slot | null> = Array.from({ length: HOTBAR_SIZE }, (): Slot | null => null);
  selected = 0;
  /** Se llama tras cualquier cambio (interfaz y guardado). */
  onChange?: () => void;

  select(i: number): void {
    if (i < 0 || i >= HOTBAR_SIZE || i === this.selected) return;
    this.selected = i;
    this.onChange?.();
  }

  selectedItem(): BlockId | null {
    return this.slots[this.selected]?.id ?? null;
  }

  canAdd(id: BlockId, amount = 1): boolean {
    let room = 0;
    for (const s of this.slots) {
      if (s === null) room += MAX_STACK;
      else if (s.id === id) room += MAX_STACK - s.count;
    }
    return room >= amount;
  }

  /** Devuelve cuántas unidades NO cupieron (0 si cupo todo). */
  add(id: BlockId, amount = 1): number {
    let left = amount;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.count < MAX_STACK) {
        const n = Math.min(left, MAX_STACK - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i] === null) {
        const n = Math.min(left, MAX_STACK);
        this.slots[i] = { id, count: n };
        left -= n;
      }
    }
    if (left !== amount) this.onChange?.();
    return left;
  }

  /** Gasta 1 unidad del slot seleccionado. Devuelve false si estaba vacío. */
  consumeSelected(): boolean {
    const s = this.slots[this.selected];
    if (!s) return false;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.onChange?.();
    return true;
  }

  serialize(): string {
    return JSON.stringify({
      selected: this.selected,
      slots: this.slots.map((s) => (s ? [s.id, s.count] : null)),
    });
  }

  /** Restaura desde JSON. Descarta lo inválido; devuelve false si el formato no es legible. */
  restore(json: string): boolean {
    try {
      const data: unknown = JSON.parse(json);
      if (typeof data !== 'object' || data === null) return false;
      const { slots, selected } = data as { slots?: unknown; selected?: unknown };
      if (!Array.isArray(slots)) return false;

      for (let i = 0; i < HOTBAR_SIZE; i++) {
        this.slots[i] = null;
        const s: unknown = slots[i];
        if (!Array.isArray(s)) continue;
        const id = Number(s[0]);
        const count = Number(s[1]);
        if (!Number.isInteger(id) || id === 0 || !(id in BLOCK_INFO)) continue;
        if (!Number.isInteger(count) || count < 1) continue;
        this.slots[i] = { id: id as BlockId, count: Math.min(count, MAX_STACK) };
      }
      const sel = Number(selected);
      this.selected = Number.isInteger(sel) && sel >= 0 && sel < HOTBAR_SIZE ? sel : 0;
      this.onChange?.();
      return true;
    } catch {
      return false;
    }
  }
}