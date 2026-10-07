import { readResponseTextCapped } from '../common/http.js';
import { createFeedCache, sendJson } from './feedCache.js';
import {
  SPACE_TRACK_LOGIN_URL,
  SPACE_TRACK_TIP_QUERY,
  spaceTrackSatcatQuery,
  parseTipMessages,
  parseSatcatNames,
} from '../../../src/layers/reentries/records.js';

const HOUR = 3_600_000;
const CAP = 2 * 1024 * 1024;

/** Space-Track credentials from the environment, or null. */
export function spaceTrackCredentials(env = process.env) {
  const identity = String(env.SPACETRACK_IDENTITY || '').trim();
  const password = String(env.SPACETRACK_PASSWORD || '').trim();
  return identity && password ? { identity, password } : null;
}

/**
 * Run one Space-Track query through the documented single-request login
 * (`POST /ajaxauth/login` with `identity`, `password` and `query`).
 */
async function spaceTrackQuery(fetchImpl, credentials, query, signal) {
  const body = new URLSearchParams({
    identity: credentials.identity,
    password: credentials.password,
    query,
  });
  const response = await fetchImpl(SPACE_TRACK_LOGIN_URL, {
    method: 'POST',
    signal,
    redirect: 'error',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent':
        'gods-eye-view-space/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(
      response.status === 401
        ? 'Space-Track login failed'
        : `HTTP ${response.status}`,
    );
  }
  const payload = JSON.parse(
    await readResponseTextCapped(response, CAP, signal),
  );
  if (payload && !Array.isArray(payload) && payload.Login === 'Failed')
    throw new Error('Space-Track login failed');
  return payload;
}

/**
 * Official re-entry predictions (`GET /api/space/reentries`): the latest
 * Space-Track TIP message per object. Requires SPACETRACK_IDENTITY and
 * SPACETRACK_PASSWORD; without them the endpoint answers `configured:false`
 * and the layer falls back to its keyless, clearly-estimated decay watch.
 *
 * Space-Track asks API users to stay well under 30 requests/minute and 300
 * per hour; this provider makes two requests (TIP + names) at most once per
 * hour, waits 15 minutes after a failure, and never redistributes its data
 * beyond the local app.
 * @param {{fetchImpl?: Function, now?: () => number, env?: object}} [options]
 */
export function reentriesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  env = process.env,
} = {}) {
  const feed = createFeedCache({
    ttlMs: HOUR,
    staleMaxMs: 12 * HOUR,
    retryMs: 15 * 60_000,
    timeoutMs: 30_000,
    now,
    load: async (signal) => {
      const credentials = spaceTrackCredentials(env);
      if (!credentials) throw new Error('not configured');
      const tips = parseTipMessages(
        await spaceTrackQuery(
          fetchImpl,
          credentials,
          SPACE_TRACK_TIP_QUERY,
          signal,
        ),
        now(),
      );
      if (!tips) throw new Error('malformed TIP response');
      let names = new Map();
      if (tips.length) {
        try {
          names = parseSatcatNames(
            await spaceTrackQuery(
              fetchImpl,
              credentials,
              spaceTrackSatcatQuery(tips.map((tip) => tip.norad)),
              signal,
            ),
          );
        } catch {
          signal.throwIfAborted();
        }
      }
      return tips.map((tip) => ({ ...tip, ...(names.get(tip.norad) || {}) }));
    },
  });

  async function handler(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method_not_allowed' });
      if (!['/', ''].includes(String(req.url || '/').split('?')[0]))
        return sendJson(res, 404, { error: 'not_found' });
      if (!spaceTrackCredentials(env))
        return sendJson(res, 200, {
          schemaVersion: 1,
          configured: false,
          fetchedAt: null,
          stale: false,
          unavailable: true,
          reason: 'Space-Track credentials not configured',
          tips: [],
        });
      const result = await feed.read();
      return sendJson(res, 200, {
        schemaVersion: 1,
        configured: true,
        fetchedAt: result.fetchedAt,
        stale: result.stale,
        unavailable: result.value === null,
        reason:
          result.value === null
            ? result.error || 'Space-Track unavailable'
            : null,
        tips: result.value ?? [],
      });
    } catch {
      return sendJson(res, 500, { error: 'reentries_error' });
    }
  }
  // Returns nothing: Vite runs a function returned here as a post hook.
  const install = ({ middlewares }) => {
    middlewares.use('/api/space/reentries', handler);
  };
  return {
    name: 'space-reentries',
    configureServer: install,
    configurePreviewServer: install,
  };
}
