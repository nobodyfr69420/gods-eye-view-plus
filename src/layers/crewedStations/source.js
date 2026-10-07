import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { validateCrewSnapshot } from './records.js';

const LIMIT = 256 * 1024;

/**
 * Crew roster from the local `/api/space/crew` cache.
 * @param {{fetchImpl?: Function}} [options]
 */
export function createCrewSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/space/crew', { signal });
      if (!response.ok) throw new Error(`Crew HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, LIMIT, signal);
      signal?.throwIfAborted();
      return validateCrewSnapshot(payload);
    },
  };
}
