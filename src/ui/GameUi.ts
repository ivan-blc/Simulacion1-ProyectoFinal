import { BLOCK_INFO } from '../core/blockInfo';
import { HOTBAR_SIZE } from '../items/Inventory';
import type { Inventory } from '../items/Inventory';

export class GameUi {
  private readonly inventory: Inventory;
  private readonly slotEls: HTMLDivElement[] = [];
  private readonly swatchEls: HTMLDivElement[] = [];
  private readonly countEls: HTMLSpanElement[] = [];
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly messageEl: HTMLDivElement;
  private messageTimer = 0;
  private lastHealth = -1;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    // Barra de acceso rápido
    const bar = document.createElement('div');
    bar.style.cssText =
      'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:4px;z-index:10;user-select:none';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.style.cssText =
        'position:relative;width:44px;height:44px;box-sizing:border-box;border:2px solid #555;' +
        'background:rgba(0,0,0,.55);cursor:pointer';

      const num = document.createElement('span');
      num.textContent = String((i + 1) % 10);
      num.style.cssText = 'position:absolute;top:1px;left:3px;font:10px monospace;color:#bbb';

      const swatch = document.createElement('div');
      swatch.style.cssText =
        'position:absolute;inset:9px;box-sizing:border-box;border:1px solid rgba(255,255,255,.3)';

      const count = document.createElement('span');
      count.style.cssText =
        'position:absolute;right:3px;bottom:1px;font:bold 12px monospace;color:#fff;text-shadow:1px 1px 0 #000';

      slot.append(num, swatch, count);
      slot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.inventory.select(i);
      });
      bar.appendChild(slot);
      this.slotEls.push(slot);
      this.swatchEls.push(swatch);
      this.countEls.push(count);
    }

    // Barra de vida
    const health = document.createElement('div');
    health.style.cssText =
      'position:fixed;top:8px;right:8px;width:170px;height:16px;box-sizing:border-box;' +
      'border:2px solid #222;background:#400;z-index:10;pointer-events:none';
    this.healthFill = document.createElement('div');
    this.healthFill.style.cssText = 'height:100%;width:100%;background:#d33';
    this.healthText = document.createElement('span');
    this.healthText.style.cssText =
      'position:absolute;inset:0;text-align:center;font:11px/12px monospace;color:#fff;text-shadow:1px 1px 0 #000';
    health.append(this.healthFill, this.healthText);

    // Mensajes
    this.messageEl = document.createElement('div');
    this.messageEl.style.cssText =
      'position:fixed;top:48px;left:50%;transform:translateX(-50%);padding:6px 12px;' +
      'background:rgba(0,0,0,.7);color:#fff;font:13px monospace;z-index:10;' +
      'pointer-events:none;opacity:0;transition:opacity .3s';

    document.body.append(bar, health, this.messageEl);
    this.render();
  }

  render(): void {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = this.inventory.slots[i];
      this.slotEls[i].style.borderColor = i === this.inventory.selected ? '#fff' : '#555';
      this.swatchEls[i].style.visibility = slot ? 'visible' : 'hidden';
      this.swatchEls[i].style.background = slot ? BLOCK_INFO[slot.id].color : 'transparent';
      this.countEls[i].textContent = slot && slot.count > 1 ? String(slot.count) : '';
    }
  }

  setHealth(current: number, max: number): void {
    const value = Math.max(0, Math.ceil(current));
    if (value === this.lastHealth) return;
    this.lastHealth = value;
    this.healthFill.style.width = `${(value / max) * 100}%`;
    this.healthText.textContent = `${value} / ${max}`;
  }

  showMessage(text: string): void {
    this.messageEl.textContent = text;
    this.messageEl.style.opacity = '1';
    window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      this.messageEl.style.opacity = '0';
    }, 2500);
  }
}