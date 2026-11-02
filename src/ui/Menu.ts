import { seedFromText } from '../core/random';

const OVERLAY_CSS =
  'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
  'justify-content:center;gap:14px;background:rgba(8,10,18,.94);color:#eee;' +
  'font:14px monospace;z-index:100;';

const BTN_CSS =
  'min-width:260px;padding:10px 16px;font:bold 14px monospace;color:#fff;' +
  'background:#2d3a55;border:2px solid #5b6f9e;cursor:pointer;';
const BTN_SECONDARY_CSS = 'background:#262626;border-color:#555;font-weight:normal;';

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (css) el.style.cssText = css;
  if (text) el.textContent = text;
  return el;
}

function button(text: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const b = make('button', BTN_CSS + (secondary ? BTN_SECONDARY_CSS : ''), text);
  b.addEventListener('click', () => {
    b.blur(); // para que Espacio (saltar) no vuelva a pulsar el botón
    onClick();
  });
  return b;
}

// ---------------------------------------------------------------- pantalla de título

export interface StartChoice {
  seed: number;
  seedText: string;
  reset: boolean;
}

/** Muestra el menú principal. `onGesture` se ejecuta dentro del clic (necesario para desbloquear el audio). */
export function showTitleScreen(defaultSeedText: string, onGesture: () => void): Promise<StartChoice> {
  return new Promise((resolve) => {
    const root = make('div', OVERLAY_CSS);
    const title = make(
      'div',
      'font:bold 40px monospace;letter-spacing:4px;color:#fff;text-shadow:3px 3px 0 #345',
      'MUNDO DE BLOQUES',
    );
    const subtitle = make('div', 'color:#8fa3c9;margin-bottom:10px', 'terreno procedural · PixiJS');

    const label = make('label', 'display:flex;flex-direction:column;gap:4px;align-items:center;color:#aab', 'Semilla del mundo');
    const input = make(
      'input',
      'width:260px;padding:8px;font:14px monospace;text-align:center;background:#111;color:#fff;border:2px solid #444',
    );
    input.type = 'text';
    input.value = defaultSeedText;
    input.spellcheck = false;
    label.appendChild(input);

    const finish = (reset: boolean) => {
      onGesture();
      const text = input.value.trim();
      root.remove();
      resolve({ seed: seedFromText(text, 12345), seedText: text || '12345', reset });
    };

    const play = button('Jugar', () => finish(false));
    const random = button('Semilla aleatoria', () => {
      input.value = String(Math.floor(Math.random() * 1e9));
    }, true);
    const fresh = button('Nuevo mundo (borra el progreso de esta semilla)', () => {
      if (window.confirm('¿Borrar el mundo y el inventario guardados de esta semilla y empezar de cero?')) {
        finish(true);
      }
    }, true);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(false);
    });

    const help = make(
      'div',
      'margin-top:12px;color:#7d8aa8;text-align:center;line-height:1.6;font-size:12px',
    );
    help.innerHTML =
      'A/D mover · Espacio saltar · clic izq. minar o atacar · clic der. construir<br>' +
      '1-0 elegir slot · Esc pausa · M música · L luz · F3 depuración';

    root.append(title, subtitle, label, play, random, fresh, help);
    document.body.appendChild(root);
    input.focus();
    input.select();
  });
}

// ---------------------------------------------------------------- menú de pausa

export interface PauseOptions {
  onResume: () => void;
  /** Devuelve el nuevo estado. */
  onToggleMusic: () => boolean;
  onToggleSfx: () => boolean;
  onQuit: () => void;
}

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly musicBtn: HTMLButtonElement;
  private readonly sfxBtn: HTMLButtonElement;

  constructor(opts: PauseOptions) {
    this.root = make('div', OVERLAY_CSS + 'background:rgba(8,10,18,.8);display:none;');
    const title = make('div', 'font:bold 28px monospace;letter-spacing:3px;margin-bottom:8px', 'PAUSA');

    const resume = button('Continuar', opts.onResume);
    this.musicBtn = button('Música', () => {
      this.setLabel(this.musicBtn, 'Música', opts.onToggleMusic());
    }, true);
    this.sfxBtn = button('Efectos', () => {
      this.setLabel(this.sfxBtn, 'Efectos', opts.onToggleSfx());
    }, true);
    const quit = button('Guardar y salir al menú', opts.onQuit, true);

    this.root.append(title, resume, this.musicBtn, this.sfxBtn, quit);
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(musicOn: boolean, sfxOn: boolean): void {
    this.setLabel(this.musicBtn, 'Música', musicOn);
    this.setLabel(this.sfxBtn, 'Efectos', sfxOn);
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private setLabel(btn: HTMLButtonElement, name: string, on: boolean): void {
    btn.textContent = `${name}: ${on ? 'sí' : 'no'}`;
  }
}

// ---------------------------------------------------------------- pantalla de carga

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly text: HTMLDivElement;

  constructor() {
    this.root = make('div', OVERLAY_CSS + 'z-index:200;background:#080a12;transition:opacity .35s;');
    const title = make('div', 'font:bold 28px monospace;letter-spacing:3px', 'MUNDO DE BLOQUES');
    const track = make('div', 'width:320px;height:14px;border:2px solid #5b6f9e;background:#111;box-sizing:content-box');
    this.bar = make('div', 'height:100%;width:0%;background:#6ec0ff;transition:width .15s');
    track.appendChild(this.bar);
    this.text = make('div', 'color:#aab;min-height:18px', 'Cargando…');
    this.root.append(title, track, this.text);
    document.body.appendChild(this.root);
  }

  setProgress(fraction: number, message: string): void {
    const f = Math.min(1, Math.max(0, fraction));
    this.bar.style.width = `${Math.round(f * 100)}%`;
    this.text.textContent = message;
  }

  /** Muestra un error en lugar de dejar la barra congelada. */
  fail(message: string): void {
    this.text.style.color = '#ff6b6b';
    this.text.textContent = `Error: ${message} (mira la consola)`;
  }

  hide(): void {
    this.root.style.pointerEvents = 'none';
    this.root.style.opacity = '0';
    window.setTimeout(() => this.root.remove(), 400);
  }
}