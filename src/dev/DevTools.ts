import { BLOCK_INFO } from '../core/blockInfo';
import type { EnemyManager } from '../entities/EnemyManager';
import { DEFAULT_ENEMY_PARAMS } from '../entities/enemyParams';
import { DEFAULT_GEN_PARAMS, cloneGenParams } from '../world/genParams';
import type { GenParams } from '../world/genParams';
import {
  CAVE_SPECS,
  ENEMY_SPECS,
  ORE_SPECS,
  SURFACE_SPECS,
  normalizeEnemyParams,
  saveDevConfig,
} from './devParams';
import type { GenNumKey, OreNumKey, ParamSpec } from './devParams';
import { addButton, addSlider, addToggle, el, section } from './devUi';
import type { Row } from './devUi';
import { GenPreview, PREVIEW_H, PREVIEW_W } from './GenPreview';
import type { SimParams } from '../pixels/PixelSim';

const PANEL_W = 350;

type TabId = 'debug' | 'gen' | 'enemies';

/** Todo lo que el panel necesita del juego. Lo implementa main.ts. */
export interface DevHost {
  seed: number;
  /** Reglas con las que se generó el mundo al arrancar. */
  initialGen: GenParams;
  enemies: EnemyManager;
  flags: { lighting: boolean; freeCam: boolean; invulnerable: boolean };
  lightBlur: { get(): number; set(v: number): void };
  /** Simulación de arena y fluidos. */
  sim: { params: SimParams; clearNearby(): number };
  /** Reaplica las reglas: generador, workers y chunks cargados. */
  applyGeneration(params: GenParams): void;
  /** Texto del panel de métricas. */
  metrics(): string;
  /** Columna (en bloques) del jugador: centra la vista previa. */
  playerBlockX(): number;
  actions: {
    respawn(): void;
    giveItems(): void;
    summonSlime(): boolean;
    clearEnemies(): void;
    resetWorld(): void;
  };
}

export class DevTools {
  private readonly host: DevHost;
  private readonly root = el(
    'div',
    `position:fixed;top:0;left:0;bottom:0;width:${PANEL_W}px;box-sizing:border-box;padding:10px 12px;` +
      'overflow-y:auto;background:rgba(8,10,18,.93);color:#dde3f0;font:12px monospace;z-index:90;' +
      'display:none;border-right:2px solid #345',
  );
  private readonly metricsEl = el('pre', 'margin:0;white-space:pre-wrap;font:11px/1.5 monospace;color:#bfe3ff');
  private readonly statusEl = el('div', 'margin:4px 0;font-weight:bold');
  private readonly previewInfoEl = el('div', 'margin:3px 0 6px;color:#7d8aa8;font-size:11px');
  private readonly noteEl = el('div', 'min-height:16px;color:#ffd479;margin:2px 0');
  private readonly panels: Record<TabId, HTMLDivElement> = {
    debug: el('div'),
    gen: el('div'),
    enemies: el('div'),
  };
  private readonly tabButtons: Record<TabId, HTMLButtonElement>;
  private readonly preview: GenPreview;

  private readonly genRows: Row[] = [];
  private readonly enemyRows: Row[] = [];
  private readonly toggleRows: Row[] = [];

  private working: GenParams;
  private applied: GenParams;
  private autoApply = true;
  private activeTab: TabId = 'debug';
  private open = false;
  private metricsTimer = 0;
  private previewTimer = 0;
  private noteTimer = 0;

  constructor(host: DevHost) {
    this.host = host;
    this.working = cloneGenParams(host.initialGen);
    this.applied = cloneGenParams(host.initialGen);
    this.preview = new GenPreview(host.seed);

    const title = el('div', 'font:bold 13px monospace;letter-spacing:1px;color:#fff', 'HERRAMIENTAS DE DESARROLLO');
    const sub = el('div', 'color:#7d8aa8;font-size:11px', 'F1 abre y cierra este panel · solo existe con npm run dev');

    const tabBar = el('div', 'display:flex;gap:4px;margin:8px 0');
    const makeTab = (id: TabId, text: string): HTMLButtonElement => {
      const b = el(
        'button',
        'flex:1;padding:6px 4px;font:12px monospace;color:#fff;border:1px solid #456;cursor:pointer',
        text,
      );
      b.addEventListener('click', () => {
        this.selectTab(id);
        b.blur();
      });
      tabBar.appendChild(b);
      return b;
    };
    this.tabButtons = {
      debug: makeTab('debug', 'Depuración'),
      gen: makeTab('gen', 'Generación'),
      enemies: makeTab('enemies', 'Enemigos'),
    };

    this.buildDebug(this.panels.debug);
    this.buildGen(this.panels.gen);
    this.buildEnemies(this.panels.enemies);

    this.root.append(title, sub, tabBar, this.noteEl, this.panels.debug, this.panels.gen, this.panels.enemies);
    document.body.appendChild(this.root);
    this.selectTab('debug');
    this.refreshStatus();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault(); // evita la ayuda del navegador
        if (!e.repeat) this.toggle();
      }
    });
  }

  toggle(): void {
    this.open = !this.open;
    this.root.style.display = this.open ? 'block' : 'none';
    if (this.open) {
      this.metricsTimer = 1; // refresca las métricas en el siguiente frame
      this.schedulePreview(0);
    }
  }

  /** Llamar una vez por frame. No hace nada si el panel está cerrado. */
  update(dt: number): void {
    if (!this.open) return;
    this.metricsTimer += dt;
    if (this.metricsTimer < 0.25) return;
    this.metricsTimer = 0;
    this.metricsEl.textContent = this.host.metrics();
    for (const r of this.toggleRows) r.refresh(); // por si se cambió con una tecla (L, F)
  }

  // ------------------------------------------------------------ pestañas

  private selectTab(id: TabId): void {
    this.activeTab = id;
    for (const k of Object.keys(this.panels) as TabId[]) {
      this.panels[k].style.display = k === id ? 'block' : 'none';
      this.tabButtons[k].style.background = k === id ? '#33507f' : '#1c2436';
    }
    if (id === 'gen') this.schedulePreview(0);
  }

  private flash(text: string): void {
    this.noteEl.textContent = text;
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => {
      this.noteEl.textContent = '';
    }, 3000);
  }

  // ------------------------------------------------------------ depuración

  private buildDebug(p: HTMLDivElement): void {
    const metrics = section(p, 'MÉTRICAS');
    metrics.appendChild(this.metricsEl);

    const options = section(p, 'OPCIONES');
    const f = this.host.flags;
    this.toggleRows.push(
      addToggle(options, 'Iluminación (L)', () => f.lighting, (v) => { f.lighting = v; }),
      addToggle(options, 'Cámara libre (F)', () => f.freeCam, (v) => { f.freeCam = v; }),
      addToggle(options, 'Invulnerable', () => f.invulnerable, (v) => { f.invulnerable = v; }),
    );
    addSlider(options, {
      label: 'Suavizado de sombras (pasadas)',
      hint: '0 = sin desenfoque',
      min: 0,
      max: 3,
      step: 1,
      get: () => this.host.lightBlur.get(),
      set: (v) => this.host.lightBlur.set(v),
      commit: () => {},
    });
    
    const simSection = section(p, 'SIMULACIÓN DE ARENA Y FLUIDOS');
    const sp = this.host.sim.params;
    this.toggleRows.push(
      addToggle(simSection, 'Simulación activada', () => sp.enabled, (v) => { sp.enabled = v; }),
    );
    addSlider(simSection, {
      label: 'Ticks por segundo',
      min: 5,
      max: 60,
      step: 1,
      get: () => sp.tickRate,
      set: (v) => { sp.tickRate = v; },
      commit: () => {},
    });
    addSlider(simSection, {
      label: 'Caída (celdas por tick)',
      hint: 'Celdas que cae un píxel por tick de simulación.',
      min: 1,
      max: 8,
      step: 1,
      get: () => sp.fallCells,
      set: (v) => { sp.fallCells = v; },
      commit: () => {},
    });
    addSlider(simSection, {
      label: 'Alcance horizontal del agua',
      hint: 'Celdas que mira el agua buscando un desnivel.',
      min: 1,
      max: 16,
      step: 1,
      get: () => sp.waterReach,
      set: (v) => { sp.waterReach = v; },
      commit: () => {},
    });
    addSlider(simSection, {
      label: 'Alcance horizontal de la lava',
      min: 1,
      max: 8,
      step: 1,
      get: () => sp.lavaReach,
      set: (v) => { sp.lavaReach = v; },
      commit: () => {},
    });
    addSlider(simSection, {
      label: 'Lava: se mueve cada N ticks',
      hint: 'A mayor valor, más viscosa.',
      min: 1,
      max: 4,
      step: 1,
      get: () => sp.lavaEvery,
      set: (v) => { sp.lavaEvery = v; },
      commit: () => {},
    });
    addButton(simSection, 'Limpiar arena y fluidos (radio 40)', () => {
      this.flash(`Se eliminaron ${this.host.sim.clearNearby()} celdas`);
    });

    const actions = section(p, 'ACCIONES');
    addButton(actions, 'Reaparecer', () => this.host.actions.respawn());
    addButton(actions, 'Dar ítems (99 de cada)', () => {
      this.host.actions.giveItems();
      this.flash('Ítems añadidos al inventario');
    });
    addButton(
      actions,
      'Borrar guardado y reiniciar',
      () => {
        if (window.confirm('¿Borrar el mundo y el inventario guardados de esta semilla y reiniciar?')) {
          this.host.actions.resetWorld();
        }
      },
      true,
    );
    actions.appendChild(
      el(
        'div',
        'margin-top:8px;color:#7d8aa8;font-size:11px;line-height:1.4',
        'El mapa 2D completo está en la URL ?debug. Las pruebas automáticas se ejecutan al cargar (consola).',
      ),
    );
  }

  // ------------------------------------------------------------ generación

  private buildGen(p: HTMLDivElement): void {
    p.append(this.statusEl, this.preview.canvas, this.previewInfoEl);

    const apply = section(p, 'APLICAR');
    addToggle(apply, 'Regenerar al soltar el control', () => this.autoApply, (v) => { this.autoApply = v; });
    addButton(apply, 'Aplicar ahora', () => this.applyNow());
    addButton(apply, 'Restablecer', () => this.resetGen());
    addButton(apply, 'Copiar JSON', () => {
      void this.copyJson();
    });
    addButton(apply, 'Centrar vista', () => this.schedulePreview(0));

    const surface = section(p, 'SUPERFICIE');
    for (const spec of SURFACE_SPECS) this.genSlider(surface, spec);

    const caves = section(p, 'CUEVAS (autómatas celulares)');
    for (const spec of CAVE_SPECS) this.genSlider(caves, spec);

    const ores = section(p, 'MINERALES');
    this.working.ores.forEach((ore, i) => {
      ores.appendChild(el('div', 'margin:8px 0 2px;color:#ffd479', BLOCK_INFO[ore.id].name.toUpperCase()));
      for (const spec of ORE_SPECS) this.oreSlider(ores, i, spec);
    });
  }

  private genSlider(parent: HTMLElement, spec: ParamSpec<GenNumKey>): void {
    this.genRows.push(
      addSlider(parent, {
        label: spec.label,
        hint: spec.hint,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        get: () => this.working[spec.key],
        set: (v) => {
          this.working[spec.key] = v;
          this.onGenEdited();
        },
        commit: () => this.onGenCommit(),
      }),
    );
  }

  private oreSlider(parent: HTMLElement, index: number, spec: ParamSpec<OreNumKey>): void {
    this.genRows.push(
      addSlider(parent, {
        label: spec.label,
        hint: spec.hint,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        get: () => this.working.ores[index][spec.key],
        set: (v) => {
          this.working.ores[index][spec.key] = v;
          this.onGenEdited();
        },
        commit: () => this.onGenCommit(),
      }),
    );
  }

  private onGenEdited(): void {
    this.refreshStatus();
    this.schedulePreview(150);
  }

  private onGenCommit(): void {
    if (this.autoApply) this.applyNow();
  }

  private applyNow(): void {
    this.host.applyGeneration(cloneGenParams(this.working));
    this.applied = cloneGenParams(this.working);
    this.persist();
    this.refreshStatus();
    this.flash('Reglas aplicadas: mundo regenerado');
  }

  private resetGen(): void {
    this.working = cloneGenParams(DEFAULT_GEN_PARAMS);
    for (const r of this.genRows) r.refresh();
    this.refreshStatus();
    this.schedulePreview(0);
    if (this.autoApply) this.applyNow();
  }

  private persist(): void {
    saveDevConfig({ gen: this.applied, enemy: this.host.enemies.params });
  }

  private refreshStatus(): void {
    const dirty = JSON.stringify(this.working) !== JSON.stringify(this.applied);
    const custom = JSON.stringify(this.applied) !== JSON.stringify(DEFAULT_GEN_PARAMS);
    this.statusEl.textContent =
      (dirty ? '● Cambios sin aplicar' : '● Aplicado al mundo') + (custom ? ' · distinto del valor por defecto' : '');
    this.statusEl.style.color = dirty ? '#ffb84d' : '#6ee7a0';
  }

  private schedulePreview(delay: number): void {
    window.clearTimeout(this.previewTimer);
    if (!this.open || this.activeTab !== 'gen') return;
    this.previewTimer = window.setTimeout(() => {
      const ms = this.preview.render(this.working, this.host.playerBlockX());
      this.previewInfoEl.textContent =
        `Vista previa ${PREVIEW_W}×${PREVIEW_H} bloques · semilla ${this.host.seed} · ${ms.toFixed(0)} ms · marca roja = jugador`;
    }, delay);
  }

  private async copyJson(): Promise<void> {
    const json = JSON.stringify({ gen: this.working, enemy: this.host.enemies.params }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.flash('JSON copiado al portapapeles');
    } catch {
      window.prompt('Copia el JSON (Ctrl+C):', json);
    }
  }

  // ------------------------------------------------------------ enemigos

  private buildEnemies(p: HTMLDivElement): void {
    const params = this.host.enemies.params;
    const refreshAll = (): void => {
      for (const r of this.enemyRows) r.refresh();
    };

    const spawn = section(p, 'APARICIÓN');
    this.enemyRows.push(
      addToggle(
        spawn,
        'Aparición activada',
        () => params.spawnEnabled,
        (v) => {
          params.spawnEnabled = v;
          this.persist();
        },
      ),
    );
    for (const spec of ENEMY_SPECS) {
      this.enemyRows.push(
        addSlider(spawn, {
          label: spec.label,
          hint: spec.hint,
          min: spec.min,
          max: spec.max,
          step: spec.step,
          get: () => params[spec.key],
          set: (v) => {
            params[spec.key] = v;
            normalizeEnemyParams(params);
            refreshAll();
          },
          commit: () => this.persist(),
        }),
      );
    }

    const actions = section(p, 'ACCIONES');
    addButton(actions, 'Invocar slime', () => {
      this.flash(this.host.actions.summonSlime() ? 'Slime invocado' : 'No se encontró suelo libre cerca');
    });
    addButton(actions, 'Borrar enemigos', () => this.host.actions.clearEnemies());
    addButton(actions, 'Restablecer', () => {
      Object.assign(params, DEFAULT_ENEMY_PARAMS);
      refreshAll();
      this.persist();
    });
  }
}