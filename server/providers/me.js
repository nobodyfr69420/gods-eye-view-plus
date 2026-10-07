import os from 'node:os';
import { timingSafeEqual, createHash } from 'node:crypto';
import { admitKeySetupRequest } from '../../src/keySetupCore.mjs';
import { admitSameSite } from './common/same-site.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { readRequestBody } from './common/request.js';
import {
  fixFromOsmAnd,
  fixFromOwnTracks,
  fixesFromBrowser,
  fixesFromOverland,
  ingestCredential,
  normalizeFix,
  sanitizeDevice,
} from './me/ingest.js';
import { createMeStore } from './me/store.js';

/**
 * ME — track yourself. Everything stays on this machine (.gev-cache/me/).
 *
 * Ingest (token-protected; for your own phone's tracking app):
 *   POST /api/me/owntracks          OwnTracks HTTP mode (Basic auth password = token)
 *   GET|POST /api/me/osmand          Traccar Client / GPSLogger (OsmAnd protocol, ?token=)
 *   POST /api/me/overland?token=     Overland batches
 * From the app itself (same-origin):
 *   POST /api/me/browser             browser Geolocation fixes
 * Local-only (the machine running the server, or ?token=):
 *   GET  /api/me/state               devices + latest fixes
 *   GET  /api/me/track               fixes (?device=&since=&limit=)
 *   GET  /api/me/setup               ingest token + URLs for configuring phone apps
 *   GET  /api/me/ip                  this machine's approximate location by public IP
 *   POST /api/me/import              store fixes parsed from your own files
 *   POST /api/me/forget              delete history ({device} or everything)
 */

const IP_LOOKUP_URL = 'https://ipwho.is/';

function sameToken(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return Boolean(a) && Boolean(b) && timingSafeEqual(x, y);
}

/** Non-internal IPv4 addresses a phone on the same network could reach. */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const entry of list || []) {
      if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4))
        continue;
      if (/^169\.254\./.test(entry.address)) continue;
      out.push({ name, address: entry.address });
    }
  }
  // A phone reaches the real Wi-Fi/Ethernet adapter, not WSL/Hyper-V/Docker/VM
  // bridges; Tailscale (100.64/10) is next best for away-from-home.
  const score = ({ name, address }) =>
    (/vethernet|wsl|hyper-v|docker|virtualbox|vmware|vbox|bridge|br-|veth/i.test(
      name,
    )
      ? -20
      : 0) +
    (/wi-?fi|wlan|ethernet|^en|^eth/i.test(name) ? 10 : 0) +
    (/^192\.168\./.test(address) ? 6 : /^10\./.test(address) ? 4 : 0) +
    (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ? 3 : 0) +
    (/^172\.(1[6-9]|2\d|3[01])\./.test(address) ? -4 : 0);
  return out.sort((a, b) => score(b) - score(a));
}

/** Map the transistorsoft JSON body (Traccar Client 8+) onto OsmAnd params. */
export function osmandParamsFromJson(body) {
  const location = body?.location;
  const coords = location?.coords;
  if (!coords) return null;
  return {
    id: body.device_id || body.id,
    lat: coords.latitude,
    lon: coords.longitude,
    timestamp: location.timestamp,
    altitude: coords.altitude,
    accuracy: coords.accuracy,
    spd_ms: coords.speed >= 0 ? coords.speed : null,
    bearing: coords.heading >= 0 ? coords.heading : null,
    batt:
      typeof location.battery?.level === 'number' && location.battery.level >= 0
        ? location.battery.level * 100
        : null,
  };
}

export function createMeHandler({
  store = createMeStore(),
  fetchImpl = (...args) => globalThis.fetch(...args),
  env = process.env,
  getServerHost = () => env.HOST || 'localhost',
  interfaces = () => os.networkInterfaces(),
} = {}) {
  const ingestLimiter = makeRateLimiter({
    windowMs: 60_000,
    max: 600,
    globalMax: 3000,
  });
  const localLimiter = makeRateLimiter({
    windowMs: 60_000,
    max: 600,
    globalMax: 2000,
  });
  let ipCache = null;

  const send = (res, status, value, type = 'application/json') => {
    if (res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(
      type === 'application/json' ? JSON.stringify(value) : String(value),
    );
  };

  async function readJson(req, maxBytes) {
    const text = await readRequestBody(req, maxBytes);
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  /** Local (loopback, unproxied, unshared) — or presenting the ingest token. */
  function admitLocal(req, url) {
    const credential = ingestCredential(req.headers, url.searchParams);
    if (credential.token && sameToken(credential.token, store.token()))
      return { ok: true };
    return admitKeySetupRequest({
      method: req.method,
      remoteAddress: req.socket?.remoteAddress,
      hostHeader: req.headers?.host,
      protocol: req.socket?.encrypted ? 'https:' : 'http:',
      origin: req.headers?.origin,
      contentType: req.headers?.['content-type'],
      proxyHeaders: req.headers || {},
      env,
    });
  }

  function admitIngest(req, url) {
    // A browser page elsewhere must never be able to post into your history.
    const site = String(req.headers['sec-fetch-site'] || '');
    if (site && !['same-origin', 'none'].includes(site))
      return { ok: false, status: 403, error: 'cross_site_refused' };
    const credential = ingestCredential(req.headers, url.searchParams);
    if (!sameToken(credential.token, store.token()))
      return { ok: false, status: 401, error: 'bad_or_missing_token' };
    return { ok: true, user: credential.user };
  }

  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    try {
      // ── ingest from your own devices ──────────────────────────────────
      if (['/owntracks', '/osmand', '/overland'].includes(route)) {
        if (!ingestLimiter(clientKey(req)))
          return send(res, 429, { error: 'rate_limited' });
        const gate = admitIngest(req, url);
        if (!gate.ok) {
          if (gate.status === 401)
            res.setHeader?.(
              'WWW-Authenticate',
              'Basic realm="gods-eye-view ME"',
            );
          return send(res, gate.status, { error: gate.error });
        }
        if (route === '/owntracks') {
          if (req.method !== 'POST')
            return send(res, 405, { error: 'method_not_allowed' });
          const body = await readJson(req, 64 * 1024);
          const device = sanitizeDevice(
            gate.user || req.headers['x-limit-d'] || body?.tid,
            'phone',
          );
          const fix = fixFromOwnTracks(body, { device });
          if (fix) store.add([fix]);
          // OwnTracks expects a JSON array (friends/cards it should display).
          return send(res, 200, []);
        }
        if (route === '/osmand') {
          let params = url.searchParams;
          if (req.method === 'POST') {
            const text = await readRequestBody(req, 64 * 1024);
            const type = String(req.headers['content-type'] || '');
            if (/json/.test(type) && text.trim()) {
              params = osmandParamsFromJson(JSON.parse(text)) ?? params;
            } else if (text.trim()) {
              const form = new URLSearchParams(text);
              for (const [k, v] of url.searchParams)
                if (!form.has(k)) form.set(k, v);
              params = form;
            }
          } else if (req.method !== 'GET') {
            return send(res, 405, { error: 'method_not_allowed' });
          }
          const fix = fixFromOsmAnd(params);
          if (!fix) return send(res, 400, 'invalid location', 'text/plain');
          store.add([fix]);
          return send(res, 200, 'OK', 'text/plain');
        }
        if (req.method !== 'POST')
          return send(res, 405, { error: 'method_not_allowed' });
        const body = await readJson(req, 4 * 1024 * 1024);
        const device = url.searchParams.get('device');
        store.add(
          fixesFromOverland(body, {
            device: device ? sanitizeDevice(device) : null,
          }),
        );
        return send(res, 200, { result: 'ok' });
      }

      // ── the app's own browser fixes ───────────────────────────────────
      if (route === '/browser') {
        if (admitSameSite(req, res)) return undefined;
        if (req.method !== 'POST')
          return send(res, 405, { error: 'method_not_allowed' });
        if (!ingestLimiter(clientKey(req)))
          return send(res, 429, { error: 'rate_limited' });
        const body = await readJson(req, 256 * 1024);
        const added = store.add(fixesFromBrowser(body));
        return send(res, 200, { added });
      }

      // ── local-only views ──────────────────────────────────────────────
      if (!localLimiter(clientKey(req)))
        return send(res, 429, { error: 'rate_limited' });
      const gate = admitLocal(req, url);
      if (!gate.ok) return send(res, gate.status, { error: gate.error });

      if (route === '/state' && req.method === 'GET') {
        return send(res, 200, {
          schemaVersion: 1,
          devices: store.devices().map((d) => ({
            device: d.device,
            count: d.count,
            first: d.first,
            src: d.src,
            last: d.last,
          })),
        });
      }
      if (route === '/track' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since')) || 0;
        const limit = Math.min(
          50_000,
          Math.max(1, Number(url.searchParams.get('limit')) || 20_000),
        );
        const device = url.searchParams.get('device');
        return send(res, 200, {
          schemaVersion: 1,
          fixes: store.track({
            device: device ? sanitizeDevice(device) : null,
            since,
            limit,
          }),
        });
      }
      if (route === '/setup' && req.method === 'GET') {
        const host = String(getServerHost() || 'localhost');
        const port = req.socket?.localPort || Number(env.PORT) || 4173;
        const lan = lanAddresses(interfaces());
        return send(res, 200, {
          schemaVersion: 1,
          token: store.token(),
          tokenFromEnv: Boolean(String(env.ME_INGEST_TOKEN ?? '').trim()),
          port,
          reachableOnLan:
            ['0.0.0.0', '::', 'true'].includes(host) ||
            lan.some((a) => a.address === host),
          lan: lan.map((a) => ({
            ...a,
            base: `http://${a.address}:${port}/api/me`,
          })),
          paths: {
            owntracks: '/owntracks',
            osmand: '/osmand',
            overland: '/overland',
          },
        });
      }
      if (route === '/ip' && req.method === 'GET') {
        if (ipCache && Date.now() - ipCache.at < 10 * 60_000)
          return send(res, 200, ipCache.value);
        const response = await fetchImpl(IP_LOOKUP_URL, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'gods-eye-view ME',
          },
          signal: AbortSignal.timeout(10_000),
        });
        const body = await response.json().catch(() => null);
        if (
          !response.ok ||
          !body ||
          body.success === false ||
          !Number.isFinite(body.latitude)
        )
          return send(res, 502, { error: 'ip_lookup_failed' });
        const value = {
          schemaVersion: 1,
          ip: body.ip,
          city: body.city,
          region: body.region,
          country: body.country,
          lat: body.latitude,
          lon: body.longitude,
          isp: body.connection?.isp || body.connection?.org || null,
          timezone: body.timezone?.id || null,
          source: 'ipwho.is',
          note: 'IP location is approximate (usually city-level, sometimes your ISP’s hub)',
        };
        ipCache = { at: Date.now(), value };
        return send(res, 200, value);
      }
      if (route === '/import' && req.method === 'POST') {
        const body = await readJson(req, 12 * 1024 * 1024);
        const device = sanitizeDevice(body?.device, 'import');
        const list = Array.isArray(body?.fixes)
          ? body.fixes.slice(0, 50_000)
          : [];
        const added = store.add(
          list
            .map((item) => normalizeFix({ ...item, device, src: 'import' }))
            .filter(Boolean),
        );
        return send(res, 200, { added, received: list.length });
      }
      if (route === '/forget' && req.method === 'POST') {
        const body = await readJson(req, 4096);
        const device = body?.device ? sanitizeDevice(body.device) : null;
        const removed = store.forget(device);
        return send(res, 200, { removed });
      }
      return send(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE')
        return send(res, 413, { error: 'body_too_large' });
      if (error instanceof SyntaxError)
        return send(res, 400, { error: 'invalid_json' });
      return send(res, 500, { error: 'me_failed' });
    }
  };
}

/** Vite plugin: dev and preview servers. */
export function meProxy(options = {}) {
  let host = null;
  const handler = createMeHandler({
    ...options,
    getServerHost: () => host ?? process.env.HOST,
  });
  const mount = (server) => {
    const configured =
      server.config?.server?.host ?? server.config?.preview?.host;
    host =
      configured === true
        ? '0.0.0.0'
        : configured || process.env.HOST || 'localhost';
    server.middlewares.use('/api/me', handler);
  };
  return {
    name: 'me-tracking',
    configureServer(server) {
      mount(server);
    },
    configurePreviewServer(server) {
      mount(server);
    },
  };
}
