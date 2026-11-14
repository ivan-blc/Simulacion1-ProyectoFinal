import { BLOCK_STACK, isValidItem, maxStack } from './items';

export interface Slot {
  id: number;
  count: number;
}

export const HOTBAR_SIZE = 10;
export const MAX_STACK = BLOCK_STACK;

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

  selectedItem(): number | null {
    return this.slots[this.selected]?.id ?? null;
  }

  canAdd(id: number, amount = 1): boolean {
    const max = maxStack(id);
    let room = 0;
    for (const s of this.slots) {
      if (s === null) room += max;
      else if (s.id === id) room += max - s.count;
    }
    return room >= amount;
  }

  /** Total de unidades de un ítem en toda la barra. */
  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Quita unidades de un ítem repartidas por los slots. Si no hay suficientes, no quita nada y devuelve false. */
  remove(id: number, amount = 1): boolean {
    if (this.count(id) < amount) return false;
    let left = amount;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(s.count, left);
      s.count -= n;
      left -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.onChange?.();
    return true;
  }

  /** Devuelve cuántas unidades NO cupieron (0 si cupo todo). */
  add(id: number, amount = 1): number {
    const max = maxStack(id);
    let left = amount;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.count < max) {
        const n = Math.min(left, max - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i] === null) {
        const n = Math.min(left, max);
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
        if (!Number.isInteger(id) || !isValidItem(id)) continue;
        if (!Number.isInteger(count) || count < 1) continue;
        this.slots[i] = { id, count: Math.min(count, maxStack(id)) };
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