import { SATELLITE_GROUP_NAMES } from './model.js';

const GROUPS = new Set(SATELLITE_GROUP_NAMES);

/**
 * Read CelesTrak group TLE text through the existing `/api/celestrak` cache.
 * The proxy refreshes each group at most every six hours and serves its last
 * copy (marked `STALE-ERROR`) while CelesTrak is unreachable.
 * @param {{fetchImpl?: Function}} [options]
 */
export function createSatelliteGroupSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    /**
     * @param {string} group CelesTrak GROUP name from the category table.
     * @param {{signal?: AbortSignal}} [options]
     * @returns {Promise<{ok:boolean, status:number, text:string, stale:boolean, fetchedAt:number|null}>}
     */
    async readGroup(group, { signal } = {}) {
      if (!GROUPS.has(group)) throw new TypeError('Unknown satellite group');
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `/api/celestrak/${encodeURIComponent(group)}`,
        { signal },
      );
      const text = response.ok ? await response.text() : '';
      signal?.throwIfAborted();
      const header = (name) => response.headers?.get?.(name) ?? null;
      const fetchedAt = Number(header('x-tle-fetched-at') ?? NaN);
      return {
        ok: response.ok && /^1 /m.test(text),
        status: response.status,
        text,
        stale: header('x-tle-cache') === 'STALE-ERROR',
        fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null,
      };
    },
  };
}
