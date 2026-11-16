import { showDebugMap } from './debugMap';
import { DevTools } from './DevTools';
import type { DevHost } from './DevTools';
import { loadDevConfig } from './devParams';
import {
  runPhase10Tests,
  runPhase11Tests,
  runPhase12Tests,
  runPhase1Tests,
  runPhase2Tests,
  runPhase4Tests,
  runPhase5Tests,
  runPhase6Tests,
  runPhase7Tests,
  runPhase8Tests,
  runPhase9Tests,
  verifyWorkerChunk,
} from './tests';

export { loadDevConfig, showDebugMap, verifyWorkerChunk };

export function runAllTests(): void {
  runPhase1Tests();
  runPhase2Tests();
  runPhase4Tests();
  runPhase5Tests();
  runPhase6Tests();
  runPhase7Tests();
  runPhase8Tests();
  runPhase9Tests();
  runPhase10Tests();
  runPhase11Tests();
  runPhase12Tests();
}

export function createDevTools(host: DevHost): DevTools {
  return new DevTools(host);
}