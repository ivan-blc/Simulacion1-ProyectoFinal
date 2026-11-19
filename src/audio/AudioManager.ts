const SETTINGS_KEY = 'terraria-pixi-settings';
const SCALE = [0, 2, 4, 7, 9]; // pentatónica mayor
const ROOT_HZ = 196; // sol3
const STEP = 0.6; // segundos entre pasos de la música

export type Sfx = 'mine' | 'place' | 'hit' | 'hurt' | 'death';

/** Separación mínima entre dos reproducciones del mismo efecto (evita el ruido al arrastrar). */
const MIN_GAP: Record<Sfx, number> = { mine: 0.05, place: 0.05, hit: 0.1, hurt: 0.3, death: 1 };

interface Graph {
  ctx: AudioContext;
  music: GainNode;
  sfx: GainNode;
  noise: AudioBuffer;
}

export class AudioManager {
  musicOn = true;
  sfxOn = true;

  private graph: Graph | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private degree = 4;
  private readonly lastPlayed = new Map<Sfx, number>();

  constructor() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s: unknown = JSON.parse(raw);
        if (typeof s === 'object' && s !== null) {
          const o = s as { music?: unknown; sfx?: unknown };
          if (typeof o.music === 'boolean') this.musicOn = o.music;
          if (typeof o.sfx === 'boolean') this.sfxOn = o.sfx;
        }
      }
    } catch {
      /* valores por defecto */
    }

    // Con la pestaña oculta el audio se pausa
    document.addEventListener('visibilitychange', () => {
      const g = this.graph;
      if (!g) return;
      if (document.hidden) void g.ctx.suspend();
      else void g.ctx.resume();
    });
  }

  /** Llamar desde un gesto del usuario (clic o tecla). Es seguro llamarlo varias veces. */
  unlock(): void {
    if (this.graph) {
      void this.graph.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);

      const music = ctx.createGain();
      music.gain.value = this.musicOn ? 1 : 0;
      music.connect(master);

      const sfx = ctx.createGain();
      sfx.gain.value = this.sfxOn ? 1 : 0;
      sfx.connect(master);

      // Un buffer de ruido blanco reutilizable para los efectos de impacto
      const len = Math.floor(ctx.sampleRate * 0.25);
      const noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.graph = { ctx, music, sfx, noise };
      this.nextNoteTime = ctx.currentTime + 0.3;
      window.setInterval(() => this.scheduleMusic(), 250);
      void ctx.resume();
    } catch {
      this.graph = null; // sin audio disponible: el juego sigue sin sonido
    }
  }

  setMusic(on: boolean): boolean {
    this.musicOn = on;
    const g = this.graph;
    if (g) g.music.gain.setTargetAtTime(on ? 1 : 0, g.ctx.currentTime, 0.15);
    this.saveSettings();
    return on;
  }

  setSfx(on: boolean): boolean {
    this.sfxOn = on;
    const g = this.graph;
    if (g) g.sfx.gain.setTargetAtTime(on ? 1 : 0, g.ctx.currentTime, 0.05);
    this.saveSettings();
    return on;
  }

  play(kind: Sfx): void {
    const g = this.graph;
    if (!g || !this.sfxOn) return;

    const now = g.ctx.currentTime;
    if (now - (this.lastPlayed.get(kind) ?? -1) < MIN_GAP[kind]) return;
    this.lastPlayed.set(kind, now);

    switch (kind) {
      case 'mine':
        this.noiseBurst(g, 0.07, 0.25, 900);
        this.tone(g, 'sine', 220, 110, 0.08, 0.12);
        break;
      case 'place':
        this.tone(g, 'triangle', 140, 90, 0.09, 0.22);
        break;
      case 'hit':
        this.noiseBurst(g, 0.06, 0.15, 2500);
        this.tone(g, 'square', 300, 150, 0.1, 0.1);
        break;
      case 'hurt':
        this.tone(g, 'sawtooth', 200, 70, 0.25, 0.18);
        break;
      case 'death':
        this.tone(g, 'sawtooth', 220, 40, 0.7, 0.22);
        break;
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ music: this.musicOn, sfx: this.sfxOn }));
    } catch {
      /* ignorar */
    }
  }

  private tone(
    g: Graph,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
  ): void {
    const t = g.ctx.currentTime;
    const osc = g.ctx.createOscillator();
    const gain = g.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(g.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(g: Graph, dur: number, vol: number, cutoff: number): void {
    const t = g.ctx.currentTime;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    const filter = g.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = g.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(g.sfx);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Programa las notas con un segundo de antelación (el reloj del audio es más preciso que setTimeout). */
  private scheduleMusic(): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;

    if (!this.musicOn || g.ctx.state !== 'running') {
      this.nextNoteTime = Math.max(this.nextNoteTime, now + 0.1);
      return;
    }
    if (this.nextNoteTime < now) this.nextNoteTime = now + 0.05; // evita ráfagas atrasadas

    while (this.nextNoteTime < now + 1) {
      this.musicStep(g, this.nextNoteTime);
      this.nextNoteTime += STEP;
    }
  }

  private musicStep(g: Graph, t: number): void {
    this.step++;

    // Acorde grave y largo cada 8 pasos
    if (this.step % 8 === 1) {
      const base = ROOT_HZ / 2;
      this.note(g, base, t, 5, 0.1, 'sine');
      this.note(g, base * 1.5, t, 5, 0.06, 'sine');
    }

    // Melodía: paseo aleatorio por la escala, con silencios
    if (Math.random() < 0.65) {
      this.degree = Math.min(9, Math.max(0, this.degree + Math.floor(Math.random() * 5) - 2));
      const semitones = SCALE[this.degree % 5] + 12 * Math.floor(this.degree / 5);
      this.note(g, ROOT_HZ * 2 ** (semitones / 12), t, 1.8, 0.1, 'triangle');
    }
  }

  private note(g: Graph, freq: number, t: number, dur: number, vol: number, type: OscillatorType): void {
    const osc = g.ctx.createOscillator();
    const gain = g.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(g.music);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}