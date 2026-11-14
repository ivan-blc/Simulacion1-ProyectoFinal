export interface Row {
  /** Vuelve a leer el valor y lo muestra. */
  refresh(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text) node.textContent = text;
  return node;
}

export function section(parent: HTMLElement, title: string): HTMLDivElement {
  const box = el('div', 'margin:12px 0 4px;padding-top:8px;border-top:1px solid #334');
  box.appendChild(el('div', 'font-weight:bold;color:#8fb4ff;letter-spacing:1px;margin-bottom:4px', title));
  parent.appendChild(box);
  return box;
}

function decimals(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export interface SliderOptions {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  /** Se llama mientras se arrastra. */
  set: (v: number) => void;
  /** Se llama al soltar o al confirmar un número escrito. */
  commit: () => void;
}

export function addSlider(parent: HTMLElement, o: SliderOptions): Row {
  const wrap = el('div', 'margin:6px 0');
  const head = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:6px');
  const label = el('span', 'color:#cfd8ea', o.label);
  if (o.hint) label.title = o.hint;

  const num = el(
    'input',
    'width:68px;padding:2px 4px;font:12px monospace;text-align:right;color:#fff;background:#111827;border:1px solid #456',
  );
  num.type = 'number';
  num.min = String(o.min);
  num.max = String(o.max);
  num.step = String(o.step);

  const range = el('input', 'width:100%;margin:3px 0 0;accent-color:#6ea8ff');
  range.type = 'range';
  range.min = String(o.min);
  range.max = String(o.max);
  range.step = String(o.step);

  head.append(label, num);
  wrap.append(head, range);
  parent.appendChild(wrap);

  const d = decimals(o.step);
  const clamp = (v: number): number => Math.min(o.max, Math.max(o.min, v));
  const show = (): void => {
    const v = o.get();
    range.value = String(v);
    num.value = v.toFixed(d);
  };

  range.addEventListener('input', () => {
    const v = Number(range.value);
    o.set(v);
    num.value = v.toFixed(d);
  });
  range.addEventListener('change', () => {
    o.commit();
    range.blur(); // para que las teclas del juego (A/D/Espacio) vuelvan a funcionar
  });
  num.addEventListener('change', () => {
    const v = Number(num.value);
    if (Number.isFinite(v)) o.set(clamp(v));
    show();
    o.commit();
    num.blur();
  });

  show();
  return { refresh: show };
}

export function addToggle(
  parent: HTMLElement,
  label: string,
  get: () => boolean,
  set: (v: boolean) => void,
): Row {
  const wrap = el('label', 'display:flex;align-items:center;gap:8px;margin:5px 0;cursor:pointer');
  const box = el('input');
  box.type = 'checkbox';
  wrap.append(box, el('span', 'color:#cfd8ea', label));
  parent.appendChild(wrap);

  box.addEventListener('change', () => {
    set(box.checked);
    box.blur();
  });
  const refresh = (): void => {
    box.checked = get();
  };
  refresh();
  return { refresh };
}

export function addButton(
  parent: HTMLElement,
  text: string,
  onClick: () => void,
  danger = false,
): HTMLButtonElement {
  const b = el(
    'button',
    'padding:5px 8px;margin:3px 4px 3px 0;font:12px monospace;color:#fff;cursor:pointer;' +
      `border:1px solid ${danger ? '#a55' : '#58a'};background:${danger ? '#4a2626' : '#26364f'}`,
    text,
  );
  b.addEventListener('click', () => {
    onClick();
    b.blur();
  });
  parent.appendChild(b);
  return b;
}