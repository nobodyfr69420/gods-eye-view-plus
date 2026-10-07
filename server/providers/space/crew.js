import { readResponseTextCapped } from '../common/http.js';
import { createFeedCache, fetchJsonCapped, sendJson } from './feedCache.js';
import {
  OPEN_NOTIFY_ASTROS_URL,
  CORQUAID_PEOPLE_URL,
  parseOpenNotify,
  parseCorquaid,
} from '../../../src/layers/crewedStations/records.js';

const HOUR = 3600_000;
const CAP = 256 * 1024;

/**
 * People-in-space roster middleware (`GET /api/space/crew`).
 *
 * Tries the corquaid community roster first (it carries agency, role and
 * spacecraft), then falls back to Open Notify. Both are community-maintained
 * and can lag a crew rotation by days, which the layer states. Cached for six
 * hours; a stale roster is served for up to three days while flagged stale.
 * @param {{fetchImpl?: Function, now?: () => number}} [options]
 */
export function crewProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const roster = createFeedCache({
    ttlMs: 6 * HOUR,
    staleMaxMs: 72 * HOUR,
    retryMs: 10 * 60_000,
    now,
    load: async (signal) => {
      try {
        const people = parseCorquaid(
          await fetchJsonCapped(
            fetchImpl,
            CORQUAID_PEOPLE_URL,
            CAP,
            signal,
            readResponseTextCapped,
          ),
        );
        if (people)
          return {
            people,
            source: 'corquaid ISS APIs (community)',
          };
      } catch {
        signal.throwIfAborted();
      }
      const people = parseOpenNotify(
        await fetchJsonCapped(
          fetchImpl,
          OPEN_NOTIFY_ASTROS_URL,
          CAP,
          signal,
          readResponseTextCapped,
        ),
      );
      if (!people) throw new Error('malformed crew roster');
      return { people, source: 'Open Notify (community)' };
    },
  });

  async function handler(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method_not_allowed' });
      if (!['/', ''].includes(String(req.url || '/').split('?')[0]))
        return sendJson(res, 404, { error: 'not_found' });
      const result = await roster.read();
      return sendJson(res, 200, {
        schemaVersion: 1,
        source: result.value?.source ?? 'Unavailable',
        fetchedAt: result.fetchedAt,
        stale: result.stale,
        unavailable: result.value === null,
        reason: result.value === null ? 'Crew roster unavailable' : null,
        people: result.value?.people ?? [],
      });
    } catch {
      return sendJson(res, 500, { error: 'crew_error' });
    }
  }
  // Returns nothing: Vite runs a function returned here as a post hook.
  const install = ({ middlewares }) => {
    middlewares.use('/api/space/crew', handler);
  };
  return {
    name: 'space-crew',
    configureServer: install,
    configurePreviewServer: install,
  };
}
