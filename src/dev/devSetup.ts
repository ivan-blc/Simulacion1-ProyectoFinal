import { showDebugMap } from './debugMap';
import { DevTools } from './DevTools';
import type { DevHost } from './DevTools';
import { loadDevConfig } from './devParams';

export { loadDevConfig, showDebugMap };

export function createDevTools(host: DevHost): DevTools {
  return new DevTools(host);
}