/**
 * Browser client for the local /api/overlay-feed proxy. Requests are shared:
 * overlays that read the same feed (PM2.5 and PM10, the four country
 * choropleths) reuse one in-flight request and one cached response.
 */

const ENDPOINT = '/api/overlay-feed/';

export function feedUrl(feedId, query = {}) {
  const params = new URLSearchParams();
  if (query.bbox) {
    const { west, south, east, north } = query.bbox;
    params.set(
      'bbox',
      [west, south, east, north].map((v) => Number(v).toFixed(3)).join(','),
    );
  }
  if (query.point) {
    params.set('lat', Number(query.point.lat).toFixed(3));
    params.set('lon', Number(query.point.lon).toFixed(3));
  }
  const qs = params.toString();
  return `${ENDPOINT}${encodeURIComponent(feedId)}${qs ? `?${qs}` : ''}`;
}

export function createFeedClient({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  maxEntries = 80,
} = {}) {
  const cache = new Map(); // url → { at, value }
  const flights = new Map();
  const stats = { requests: 0, bytes: 0, errors: 0, cacheHits: 0, totalMs: 0 };
  const history = []; // last requests for the stats tab

  function remember(entry) {
    history.push(entry);
    if (history.length > 60) history.shift();
  }

  async function get(feedId, query = {}, { maxAgeMs = 60_000, signal } = {}) {
    const url = feedUrl(feedId, query);
    const hit = cache.get(url);
    if (hit && now() - hit.at < maxAgeMs) {
      stats.cacheHits++;
      return hit.value;
    }
    if (flights.has(url)) return flights.get(url);
    const started = now();
    const flight = (async () => {
      stats.requests++;
      let text = '';
      try {
        const response = await fetchImpl(url, {
          signal,
          headers: { Accept: 'application/json' },
        });
        text = await response.text();
        stats.bytes += text.length;
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        if (!response.ok || !body || !Array.isArray(body.features)) {
          const reason =
            body?.reason || body?.error || `HTTP ${response.status}`;
          throw Object.assign(new Error(reason), { status: response.status });
        }
        const value = {
          features: body.features,
          fetchedAt: body.fetchedAt ? Date.parse(body.fetchedAt) : now(),
          stale: Boolean(body.stale),
          attribution: body.attribution || null,
          bytes: text.length,
        };
        cache.set(url, { at: now(), value });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        remember({
          feedId,
          ok: true,
          ms: now() - started,
          bytes: text.length,
          at: now(),
        });
        return value;
      } catch (error) {
        if (error?.name !== 'AbortError') {
          stats.errors++;
          remember({
            feedId,
            ok: false,
            ms: now() - started,
            bytes: text.length,
            at: now(),
            error: String(error?.message || error),
          });
        }
        throw error;
      } finally {
        stats.totalMs += now() - started;
      }
    })().finally(() => flights.delete(url));
    flights.set(url, flight);
    return flight;
  }

  return { get, stats, history };
}
