import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { readCappedResponseText } from './common/http.js';
import { sameSiteGated } from './common/same-site.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { getOverlayFeed, parseCsv } from './overlayFeeds/feeds.js';

/**
 * Overlay Library feed proxy: GET /api/overlay-feed/<feedId>[?bbox=w,s,e,n | ?lat=&lon=]
 *
 * - Only allowlisted feed ids (./overlayFeeds/feeds.js); upstream URLs are fixed.
 * - Upstream bodies are cached in memory (per-URL TTL) and static reference
 *   datasets also on disk under .gev-cache/overlay-feeds (7 days), so a 12 MB
 *   CSV is downloaded once per machine per week, not once per overlay.
 * - Identical concurrent requests share one upstream fetch; a failed refresh
 *   serves the last good copy (marked stale) inside the feed's stale window.
 * - Same-site gated and rate limited like the other local proxies.
 */

const USER_AGENT =
  'gods-eye-view/0.2 overlay-library (+https://github.com/bilawalsidhu/gods-eye-view)';
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_CONCURRENT_UPSTREAMS = 6;
const RESULT_CACHE_MAX = 400;
const UPSTREAM_CACHE_MAX = 160;
const DISK_DIR = path.join(process.cwd(), '.gev-cache', 'overlay-feeds');

/** Validate and quantize `?bbox=w,s,e,n` outward to a 0.5° grid. */
export function parseOverlayBbox(raw, maxSpanDeg = 10) {
  if (typeof raw !== 'string' || raw.length > 80) return null;
  const parts = raw.split(',').map((v) => Number(v));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  let [west, south, east, north] = parts;
  if (west > east || south >= north) return null;
  west = Math.max(-180, Math.floor(west * 2) / 2);
  south = Math.max(-90, Math.floor(south * 2) / 2);
  east = Math.min(180, Math.ceil(east * 2) / 2);
  north = Math.min(90, Math.ceil(north * 2) / 2);
  if (east - west > maxSpanDeg || north - south > maxSpanDeg) return null;
  if (east <= west || north <= south) return null;
  return { west, south, east, north };
}

/** Validate and quantize `?lat=&lon=` to a 0.05° grid (≈5 km). */
export function parseOverlayPoint(latRaw, lonRaw) {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const q = (v) => Math.round(v * 20) / 20;
  return { lat: q(lat), lon: q(lon) };
}

function lruSet(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

/**
 * Build the proxy core with injectable fetch/clock/disk so tests can drive it
 * without network or filesystem.
 */
export function createOverlayFeedService({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  disk = true,
  diskDir = DISK_DIR,
} = {}) {
  const upstreamCache = new Map(); // url → { at, body, parsed: Map }
  const upstreamFlights = new Map(); // url → Promise
  const resultCache = new Map(); // key → { at, features, upstreamAt }
  const resultFlights = new Map();
  let active = 0;
  const waiting = [];
  const stats = {
    upstreamFetches: 0,
    upstreamBytes: 0,
    upstreamErrors: 0,
    diskHits: 0,
  };

  async function slot() {
    if (active < MAX_CONCURRENT_UPSTREAMS) {
      active++;
      return;
    }
    await new Promise((resolve) => waiting.push(resolve));
    active++;
  }
  function release() {
    active--;
    waiting.shift()?.();
  }

  const diskPath = (url) =>
    path.join(diskDir, `${createHash('sha1').update(url).digest('hex')}.body`);

  async function readDisk(spec) {
    if (!disk || !spec.disk) return null;
    try {
      const file = diskPath(spec.url);
      const info = await stat(file);
      if (now() - info.mtimeMs > spec.ttlMs) return null;
      stats.diskHits++;
      return { at: info.mtimeMs, text: await readFile(file, 'utf8') };
    } catch {
      return null;
    }
  }
  async function writeDisk(spec, text) {
    if (!disk || !spec.disk) return;
    try {
      await mkdir(diskDir, { recursive: true });
      const file = diskPath(spec.url);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, file);
    } catch {
      /* the disk cache is an optimization only */
    }
  }

  function decode(spec, text) {
    if (spec.format === 'text') return text;
    if (spec.format === 'csv') return parseCsv(text);
    return JSON.parse(text);
  }

  async function fetchUpstream(spec) {
    const cached = upstreamCache.get(spec.url);
    if (cached && now() - cached.at < spec.ttlMs) return cached;
    if (upstreamFlights.has(spec.url)) return upstreamFlights.get(spec.url);
    const flight = (async () => {
      const fromDisk = await readDisk(spec);
      if (fromDisk) {
        const entry = { at: fromDisk.at, body: decode(spec, fromDisk.text) };
        lruSet(upstreamCache, spec.url, entry, UPSTREAM_CACHE_MAX);
        return entry;
      }
      await slot();
      try {
        stats.upstreamFetches++;
        const response = await fetchImpl(spec.url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept:
              spec.format === 'json'
                ? 'application/json, application/geo+json;q=0.9, */*;q=0.5'
                : '*/*',
            ...(spec.headers || {}),
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (!response.ok) {
          await response.body?.cancel?.().catch?.(() => {});
          throw Object.assign(new Error(`upstream_http_${response.status}`), {
            upstreamStatus: response.status,
          });
        }
        const { tooLarge, text } = await readCappedResponseText(
          response,
          spec.maxBytes,
        );
        if (tooLarge) throw new Error('upstream_too_large');
        stats.upstreamBytes += text.length;
        const entry = { at: now(), body: decode(spec, text) };
        lruSet(upstreamCache, spec.url, entry, UPSTREAM_CACHE_MAX);
        writeDisk(spec, text);
        return entry;
      } catch (error) {
        stats.upstreamErrors++;
        // Serve an expired copy rather than nothing; callers mark it stale.
        if (cached) return { ...cached, expired: true, error };
        throw error;
      } finally {
        release();
      }
    })().finally(() => upstreamFlights.delete(spec.url));
    upstreamFlights.set(spec.url, flight);
    return flight;
  }

  /** Resolve one feed request to { features, fetchedAt, stale }. */
  async function resolve(feed, query = {}) {
    const key = `${feed.id}|${query.bbox ? Object.values(query.bbox).join(',') : ''}|${query.point ? `${query.point.lat},${query.point.lon}` : ''}`;
    const specs = feed.upstreams(query);
    const minTtl = Math.min(...specs.map((s) => s.ttlMs));
    const cached = resultCache.get(key);
    if (cached && now() - cached.at < minTtl)
      return { ...cached, stale: false };
    if (resultFlights.has(key)) return resultFlights.get(key);
    const flight = (async () => {
      try {
        const settled = await Promise.allSettled(
          specs.map((spec) => fetchUpstream(spec)),
        );
        const required = settled.filter((r, i) => !specs[i].optional);
        const failed = required.find((r) => r.status === 'rejected');
        if (failed) throw failed.reason;
        const entries = settled.map((r) =>
          r.status === 'fulfilled' ? r.value : null,
        );
        const features = feed.transform(
          entries.map((e) => e?.body ?? null),
          query,
        );
        const upstreamAt = Math.min(
          ...entries.filter(Boolean).map((e) => e.at),
        );
        const expired = entries.some((e) => e?.expired);
        const result = {
          at: now(),
          features,
          fetchedAt: upstreamAt,
          stale: expired,
        };
        lruSet(resultCache, key, result, RESULT_CACHE_MAX);
        return result;
      } catch (error) {
        if (cached && now() - cached.fetchedAt <= feed.staleMs)
          return {
            ...cached,
            stale: true,
            error: String(error?.message || error),
          };
        throw error;
      }
    })().finally(() => resultFlights.delete(key));
    resultFlights.set(key, flight);
    return flight;
  }

  return { resolve, stats };
}

/** Vite plugin wiring GET /api/overlay-feed/<id> to the feed service. */
export function overlayFeedsProxy(options = {}) {
  const service = createOverlayFeedService(options);
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 900,
    globalMax: 3000,
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
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, '')).slice(
      0,
      64,
    );
    if (id === 'status' || id === '') {
      return send(200, { schemaVersion: 1, ...service.stats });
    }
    const feed = getOverlayFeed(id);
    if (!feed) return send(404, { error: 'unknown_overlay_feed' });
    const query = {};
    if (feed.query === 'bbox') {
      query.bbox = parseOverlayBbox(
        url.searchParams.get('bbox'),
        feed.maxSpanDeg,
      );
      if (!query.bbox)
        return send(400, {
          error: 'invalid_or_too_large_bbox',
          maxSpanDeg: feed.maxSpanDeg,
        });
    } else if (feed.query === 'point') {
      query.point = parseOverlayPoint(
        url.searchParams.get('lat'),
        url.searchParams.get('lon'),
      );
      if (!query.point) return send(400, { error: 'invalid_point' });
    }
    try {
      const result = await service.resolve(feed, query);
      send(200, {
        schemaVersion: 1,
        feed: feed.id,
        attribution: feed.attribution,
        fetchedAt: result.fetchedAt
          ? new Date(result.fetchedAt).toISOString()
          : null,
        stale: Boolean(result.stale),
        count: result.features.length,
        features: result.features,
      });
    } catch (error) {
      const status = Number(error?.upstreamStatus) || null;
      send(502, {
        error: 'overlay_feed_unavailable',
        feed: feed.id,
        reason: String(error?.message || 'upstream_failed').slice(0, 120),
        upstreamStatus: status,
      });
    }
  });

  return {
    name: 'overlay-feeds',
    configureServer({ middlewares }) {
      middlewares.use('/api/overlay-feed', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/overlay-feed', handler);
    },
  };
}
