import type { WorkerRequest, WorkerResponse } from './workerMessages';
import type { ChunkProvider } from './WorldManager';

const MAX_IN_FLIGHT_PER_WORKER = 2;

export interface ChunkWorkerPoolOptions {
  seed: number;
  size: number;
  onResult: (cx: number, cy: number, blocks: Uint8Array, ms: number) => void;
  /** Un worker falló: el llamador debe volver a generar en el hilo principal. */
  onFatal: (err: unknown) => void;
}

export class ChunkWorkerPool implements ChunkProvider {
  readonly size: number;
  completed = 0;

  private totalMs = 0;
  private dead = false;
  private readonly workers: Worker[] = [];
  private readonly inFlightPer: number[] = [];
  private readonly queue: Array<{ cx: number; cy: number }> = [];
  private readonly opts: ChunkWorkerPoolOptions;

  constructor(opts: ChunkWorkerPoolOptions) {
    this.opts = opts;
    this.size = Math.max(1, opts.size);
    try {
      for (let i = 0; i < this.size; i++) {
        const worker = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
        const init: WorkerRequest = { type: 'init', seed: opts.seed };
        worker.postMessage(init);
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(i, e.data);
        worker.onerror = (e) => this.fatal(e);
        worker.onmessageerror = (e) => this.fatal(e);
        this.workers.push(worker);
        this.inFlightPer.push(0);
      }
    } catch (err) {
      this.terminate();
      throw err;
    }
  }

  get queued(): number {
    return this.queue.length;
  }

  get inFlight(): number {
    return this.inFlightPer.reduce((a, b) => a + b, 0);
  }

  get avgMs(): number {
    return this.completed === 0 ? 0 : this.totalMs / this.completed;
  }

  request(cx: number, cy: number): void {
    if (this.dead) return;
    this.queue.push({ cx, cy });
    this.pump();
  }

  /** Quita la petición de la cola si todavía no se envió a ningún worker. */
  cancel(cx: number, cy: number): void {
    const i = this.queue.findIndex((j) => j.cx === cx && j.cy === cy);
    if (i >= 0) this.queue.splice(i, 1);
  }

  dispose(): void {
    this.dead = true;
    this.terminate();
  }

  private pump(): void {
    while (!this.dead && this.queue.length > 0) {
      // El worker menos ocupado que aún tenga hueco
      let best = -1;
      for (let i = 0; i < this.workers.length; i++) {
        if (
          this.inFlightPer[i] < MAX_IN_FLIGHT_PER_WORKER &&
          (best < 0 || this.inFlightPer[i] < this.inFlightPer[best])
        ) {
          best = i;
        }
      }
      if (best < 0) return;

      const job = this.queue.shift();
      if (!job) return;
      const req: WorkerRequest = { type: 'gen', cx: job.cx, cy: job.cy };
      this.inFlightPer[best]++;
      this.workers[best].postMessage(req);
    }
  }

  private handle(i: number, msg: WorkerResponse): void {
    if (this.dead) return;
    this.inFlightPer[i]--;
    this.completed++;
    this.totalMs += msg.ms;
    this.opts.onResult(msg.cx, msg.cy, new Uint8Array(msg.buffer), msg.ms);
    this.pump();
  }

  private fatal(err: unknown): void {
    if (this.dead) return;
    this.dead = true;
    this.terminate();
    this.opts.onFatal(err);
  }

  private terminate(): void {
    for (const w of this.workers) w.terminate();
    this.queue.length = 0;
  }
}