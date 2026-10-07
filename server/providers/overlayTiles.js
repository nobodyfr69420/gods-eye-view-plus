import { sameSiteGated } from './common/same-site.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';

/**
 * Overlay tile proxy: GET /api/overlay-tile/<id>/<z>/<x>/<y>
 *
 * For raster overlays whose upstream needs a key (kept server-side, never in
 * the browser bundle) or a path resolved at request time (RainViewer's latest
 * radar frame). Ids are allowlisted; every upstream host is fixed. Tiles are
 * cached in memory, bounded by bytes.
 *
 * GET /api/overlay-tile/status → { available: { <id>: boolean } } so the
 * Overlay Library can say "needs key" instead of drawing broken tiles.
 */

const MIN = 60_000;
const TILE_CACHE_BYTES = 96 * 1024 * 1024;
const TILE_MAX_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'gods-eye-view/0.2 overlay-library (+https://github.com/bilawalsidhu/gods-eye-view)';

const owm = (layer) => ({
  env: 'OWM_API_KEY',
  maxZoom: 9,
  ttlMs: 10 * MIN,
  url: (z, x, y, key) =>
    `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${key}`,
});
const thunderforest = (style) => ({
  env: 'THUNDERFOREST_API_KEY',
  maxZoom: 22,
  ttlMs: 24 * 60 * MIN,
  url: (z, x, y, key) =>
    `https://tile.thunderforest.com/${style}/${z}/${x}/${y}.png?apikey=${key}`,
});

/** Keys that gate Overlay Library feeds (not tiles) — reported by /status. */
const KEYED_FEED_ENV_VARS = Object.freeze(['WINDY_WEBCAMS_API_KEY']);

export const OVERLAY_TILE_SOURCES = Object.freeze({
  'owm-clouds': owm('clouds_new'),
  'owm-precipitation': owm('precipitation_new'),
  'owm-pressure': owm('pressure_new'),
  'owm-wind': owm('wind_new'),
  'owm-temperature': owm('temp_new'),
  'waqi-aqi': {
    env: 'WAQI_TOKEN',
    maxZoom: 14,
    ttlMs: 20 * MIN,
    url: (z, x, y, key) =>
      `https://tiles.aqicn.org/tiles/usepa-aqi/${z}/${x}/${y}.png?token=${key}`,
  },
  'openaip-chart': {
    env: 'OPENAIP_API_KEY',
    maxZoom: 14,
    ttlMs: 24 * 60 * MIN,
    url: (z, x, y, key) =>
      `https://api.tiles.openaip.net/api/data/openaip/${z}/${x}/${y}.png?apiKey=${key}`,
  },
  'tf-transport': thunderforest('transport'),
  'tf-transport-dark': thunderforest('transport-dark'),
  'tf-cycle': thunderforest('cycle'),
  'tf-outdoors': thunderforest('outdoors'),
  'tf-landscape': thunderforest('landscape'),
  // Global Forest Watch serves no CORS headers, so it is relayed here.
  'gfw-tree-loss': {
    env: null,
    maxZoom: 12,
    ttlMs: 24 * 60 * MIN,
    url: (z, x, y) =>
      `https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/${z}/${x}/${y}.png`,
  },
  'gfw-integrated-alerts': {
    env: null,
    maxZoom: 12,
    ttlMs: 6 * 60 * MIN,
    url: (z, x, y) =>
      `https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/dynamic/${z}/${x}/${y}.png`,
  },
  'rainviewer-radar': {
    env: null,
    maxZoom: 7,
    ttlMs: 5 * MIN,
    resolve: 'rainviewer',
    url: (z, x, y, _key, frame) =>
      `${frame.host}${frame.path}/256/${z}/${x}/${y}/2/1_1.png`,
  },
});

/** Parse "<id>/<z>/<x>/<y>[.png]" into a validated tile address. */
export function parseTilePath(pathname) {
  const match =
    /^\/?([a-z0-9-]{2,40})\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(?:\.png)?$/.exec(
      String(pathname || ''),
    );
  if (!match) return null;
  const [, id, zs, xs, ys] = match;
  const source = OVERLAY_TILE_SOURCES[id];
  if (!source) return null;
  const z = Number(zs);
  const x = Number(xs);
  const y = Number(ys);
  const n = 2 ** z;
  if (z > source.maxZoom || x >= n || y >= n) return null;
  return { id, z, x, y, source };
}

/** Pick RainViewer's newest past radar frame from its index document. */
export function latestRainViewerFrame(index) {
  const past = index?.radar?.past;
  if (!Array.isArray(past) || !past.length || typeof index.host !== 'string')
    return null;
  const frame = past[past.length - 1];
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(index.host)) return null;
  if (!/^\/v2\/radar\/[A-Za-z0-9/_-]+$/.test(String(frame?.path || '')))
    return null;
  return { host: index.host, path: frame.path, time: frame.time };
}

export function createOverlayTileService({
  fetchImpl = (...args) => globalThis.fetch(...args),
  env = process.env,
  now = Date.now,
} = {}) {
  const cache = new Map(); // key → { at, ttl, bytes: Buffer, type }
  let cacheBytes = 0;
  const flights = new Map();
  let rainviewer = null; // { at, frame }

  const keyFor = (source) =>
    source.env ? String(env[source.env] ?? '').trim() : '';

  function available() {
    return Object.fromEntries(
      Object.entries(OVERLAY_TILE_SOURCES).map(([id, source]) => [
        id,
        !source.env || keyFor(source) !== '',
      ]),
    );
  }

  /** Presence (never values) of every key a keyed overlay can need. */
  function keys() {
    const names = new Set(KEYED_FEED_ENV_VARS);
    for (const source of Object.values(OVERLAY_TILE_SOURCES))
      if (source.env) names.add(source.env);
    return Object.fromEntries(
      [...names].map((name) => [name, String(env[name] ?? '').trim() !== '']),
    );
  }

  function remember(key, entry) {
    const old = cache.get(key);
    if (old) cacheBytes -= old.bytes.length;
    cache.delete(key);
    cache.set(key, entry);
    cacheBytes += entry.bytes.length;
    while (cacheBytes > TILE_CACHE_BYTES && cache.size) {
      const [oldestKey, oldest] = cache.entries().next().value;
      cache.delete(oldestKey);
      cacheBytes -= oldest.bytes.length;
    }
  }

  async function rainViewerFrame() {
    if (rainviewer && now() - rainviewer.at < 2 * MIN) return rainviewer.frame;
    const response = await fetchImpl(
      'https://api.rainviewer.com/public/weather-maps.json',
      {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`upstream_http_${response.status}`);
    const frame = latestRainViewerFrame(await response.json());
    if (!frame) throw new Error('no_radar_frame');
    rainviewer = { at: now(), frame };
    return frame;
  }

  /** Resolve a tile to { status, bytes?, type? }. */
  async function tile(address) {
    const { id, z, x, y, source } = address;
    const key = keyFor(source);
    if (source.env && !key) return { status: 404, error: 'key_missing' };
    const frame =
      source.resolve === 'rainviewer' ? await rainViewerFrame() : null;
    const cacheKey = `${id}/${z}/${x}/${y}/${frame?.time ?? ''}`;
    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < hit.ttl) return { status: 200, ...hit };
    if (flights.has(cacheKey)) return flights.get(cacheKey);
    const flight = (async () => {
      const response = await fetchImpl(source.url(z, x, y, key, frame), {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'image/png,image/*;q=0.8',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel?.().catch?.(() => {});
        return {
          status: [401, 403].includes(response.status)
            ? 502
            : response.status === 404
              ? 404
              : 502,
          error: `upstream_http_${response.status}`,
        };
      }
      const type = response.headers.get('content-type') || 'image/png';
      if (!/^image\//.test(type)) return { status: 502, error: 'not_an_image' };
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > TILE_MAX_BYTES)
        return { status: 502, error: 'tile_too_large' };
      const entry = { at: now(), ttl: source.ttlMs, bytes, type };
      remember(cacheKey, entry);
      return { status: 200, ...entry };
    })().finally(() => flights.delete(cacheKey));
    flights.set(cacheKey, flight);
    return flight;
  }

  return {
    tile,
    available,
    keys,
    stats: () => ({ tiles: cache.size, bytes: cacheBytes }),
  };
}

export function overlayTilesProxy(options = {}) {
  const service = createOverlayTileService(options);
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 6000,
    globalMax: 12000,
  });
  const handler = sameSiteGated(async (req, res) => {
    const json = (status, value) => {
      if (res.writableEnded) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    if (!limiter(clientKey(req))) return json(429, { error: 'rate_limited' });
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/status' || url.pathname === '/status/')
      return json(200, {
        schemaVersion: 1,
        available: service.available(),
        keys: service.keys(),
        ...service.stats(),
      });
    const address = parseTilePath(url.pathname);
    if (!address) return json(404, { error: 'unknown_tile' });
    try {
      const result = await service.tile(address);
      if (result.status !== 200)
        return json(result.status, { error: result.error });
      res.writeHead(200, {
        'Content-Type': result.type,
        'Cache-Control': `private, max-age=${Math.round(address.source.ttlMs / 1000)}`,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(result.bytes);
    } catch (error) {
      json(502, {
        error: String(error?.message || 'tile_failed').slice(0, 80),
      });
    }
  });
  return {
    name: 'overlay-tiles',
    configureServer({ middlewares }) {
      middlewares.use('/api/overlay-tile', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/overlay-tile', handler);
    },
  };
}
