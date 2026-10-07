import { sameSiteGated } from './common/same-site.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { WORLD_INDICATORS } from '../../src/overlayLibrary/worldIndicators.js';

/**
 * World Statistics for the WORLD tab.
 *
 *   GET /api/world-stats/summary        world (WLD) value of every indicator
 *   GET /api/world-stats/country/<ISO3> one country's fact sheet: World Bank
 *                                       metadata + every indicator + a
 *                                       Wikipedia summary
 *
 * Fixed upstreams (World Bank WDI, Wikipedia REST), cached in memory.
 */

const HOUR = 3_600_000;
const USER_AGENT =
  'gods-eye-view/0.2 world-stats (+https://github.com/bilawalsidhu/gods-eye-view)';
const BATCH = 50; // WDI accepts up to 60 indicators per request

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok)
    throw Object.assign(new Error(`upstream_http_${response.status}`), {
      upstreamStatus: response.status,
    });
  return response.json();
}

/** Batched WDI fetch for one economy → Map(code → {value, year}). */
export async function fetchIndicatorValues(fetchImpl, iso3) {
  const out = new Map();
  for (let i = 0; i < WORLD_INDICATORS.length; i += BATCH) {
    const codes = WORLD_INDICATORS.slice(i, i + BATCH).map((x) => x.code);
    const body = await getJson(
      fetchImpl,
      `https://api.worldbank.org/v2/country/${iso3}/indicator/${codes.join(';')}?source=2&format=json&mrnev=1&per_page=500`,
    );
    for (const row of Array.isArray(body?.[1]) ? body[1] : []) {
      const value = Number(row?.value);
      if (row?.value === null || !Number.isFinite(value)) continue;
      out.set(row.indicator?.id, { value, year: Number(row.date) || null });
    }
  }
  return out;
}

export function createWorldStatsService({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
} = {}) {
  const cache = new Map();
  const flights = new Map();
  async function cached(key, ttl, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    if (flights.has(key)) return flights.get(key);
    const flight = load()
      .then((value) => {
        cache.delete(key);
        cache.set(key, { at: now(), value });
        while (cache.size > 96) cache.delete(cache.keys().next().value);
        return value;
      })
      .catch((error) => {
        if (hit) return { ...hit.value, stale: true };
        throw error;
      })
      .finally(() => flights.delete(key));
    flights.set(key, flight);
    return flight;
  }

  const summary = () =>
    cached('summary', 6 * HOUR, async () => {
      const values = await fetchIndicatorValues(fetchImpl, 'WLD');
      return {
        schemaVersion: 1,
        fetchedAt: new Date(now()).toISOString(),
        world: Object.fromEntries(values),
      };
    });

  const country = (iso3) =>
    cached(`country:${iso3}`, 6 * HOUR, async () => {
      const [metaBody, values] = await Promise.all([
        getJson(
          fetchImpl,
          `https://api.worldbank.org/v2/country/${iso3}?format=json`,
        ),
        fetchIndicatorValues(fetchImpl, iso3),
      ]);
      const meta = Array.isArray(metaBody?.[1]) ? metaBody[1][0] : null;
      if (!meta)
        throw Object.assign(new Error('unknown_country'), {
          upstreamStatus: 404,
        });
      let wiki = null;
      try {
        const page = await getJson(
          fetchImpl,
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(meta.name.replace(/ /g, '_'))}`,
        );
        wiki = {
          title: page?.title || meta.name,
          extract: String(page?.extract || '').slice(0, 900),
          thumbnail: /^https:\/\/upload\.wikimedia\.org\//.test(
            page?.thumbnail?.source || '',
          )
            ? page.thumbnail.source
            : null,
          link: page?.content_urls?.desktop?.page || null,
        };
      } catch {
        /* the fact sheet stands without it */
      }
      return {
        schemaVersion: 1,
        iso3,
        name: meta.name,
        capital: meta.capitalCity || null,
        region: meta.region?.value?.trim() || null,
        income: meta.incomeLevel?.value || null,
        lending: meta.lendingType?.value || null,
        capitalLat: Number(meta.latitude) || null,
        capitalLon: Number(meta.longitude) || null,
        indicators: Object.fromEntries(values),
        wiki,
      };
    });

  return { summary, country };
}

export function worldStatsProxy(options = {}) {
  const service = createWorldStatsService(options);
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 240,
    globalMax: 600,
  });
  const handler = sameSiteGated(async (req, res) => {
    const send = (status, value) => {
      if (res.writableEnded) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    if (!limiter(clientKey(req))) return send(429, { error: 'rate_limited' });
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (url.pathname === '/summary')
        return send(200, await service.summary());
      const match = /^\/country\/([A-Za-z]{3})$/.exec(url.pathname);
      if (match)
        return send(200, await service.country(match[1].toUpperCase()));
      return send(404, { error: 'not_found' });
    } catch (error) {
      return send(error?.upstreamStatus === 404 ? 404 : 502, {
        error: String(error?.message || 'world_stats_failed').slice(0, 80),
      });
    }
  });
  return {
    name: 'world-stats',
    configureServer({ middlewares }) {
      middlewares.use('/api/world-stats', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/world-stats', handler);
    },
  };
}
