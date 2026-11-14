import { Chunk } from './Chunk';
import type { WorkerRequest, WorkerResponse } from './workerMessages';
import { WorldGenerator } from './WorldGenerator';

let gen: WorldGenerator | null = null;
let epoch = 0;

self.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    gen = new WorldGenerator(msg.seed, msg.params);
    epoch = msg.epoch;
    return;
  }
  if (msg.type === 'config') {
    gen?.setParams(msg.params);
    epoch = msg.epoch;
    return;
  }
  if (!gen) return;

  const t0 = performance.now();
  const chunk = new Chunk(msg.cx, msg.cy);
  gen.generateChunk(chunk);

  const buffer = chunk.blocks.buffer as ArrayBuffer;
  const res: WorkerResponse = {
    type: 'chunk',
    cx: msg.cx,
    cy: msg.cy,
    buffer,
    ms: performance.now() - t0,
    epoch,
  };
  // El segundo argumento transfiere el buffer: pasa de un hilo a otro sin copiarse
  self.postMessage(res, { transfer: [buffer] });
});