import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { validateReentrySnapshot } from './records.js';

const LIMIT = 512 * 1024;

/**
 * Official TIP predictions from the local `/api/space/reentries` cache.
 * @param {{fetchImpl?: Function}} [options]
 */
export function createReentrySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/space/reentries', { signal });
      if (!response.ok) throw new Error(`Re-entry HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, LIMIT, signal);
      signal?.throwIfAborted();
      return validateReentrySnapshot(payload);
    },
  };
}
