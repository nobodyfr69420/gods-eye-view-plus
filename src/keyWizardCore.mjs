/**
 * Key wizard (`npm run keys`) — the pure core.
 *
 * The CLI (scripts/keys.mjs) is a thin shell over this module: it supplies the
 * filesystem, clipboard, terminal and fetch; everything that decides what a
 * pasted string is, whether a key works and what to import lives here so it
 * can be unit tested without a network.
 *
 * Nothing here prints or returns a credential except where a caller asked for
 * the value it passed in; reports carry only `maskKey()` suffixes.
 */

import { KEY_SETUP_KEYS } from './keySetupCore.mjs';

/** Local secrets the wizard generates (never provider keys). */
export const GENERATED_SECRETS = Object.freeze([
  Object.freeze({
    envVar: 'ME_INGEST_TOKEN',
    title: 'ME INGEST TOKEN',
    purpose:
      'Lets your own phone (OwnTracks, Overland, GPSLogger, Traccar Client) post its location to the ME layer',
    bytes: 24,
  }),
]);

/**
 * Plausible shapes for each credential. `distinctive` shapes (a vendor prefix
 * or token format no other provider uses) are filed automatically whenever
 * they appear on the clipboard; the rest are only accepted for the provider
 * the wizard is currently asking for, so an ambiguous 32-hex key is never
 * sent to the wrong provider.
 */
export const KEY_SHAPES = Object.freeze({
  GOOGLE_MAPS_API_KEY: { re: /^AIza[0-9A-Za-z_-]{35}$/, distinctive: true },
  GOOGLE_MAPS_SERVER_API_KEY: { re: /^AIza[0-9A-Za-z_-]{35}$/ },
  OPENAI_API_KEY: { re: /^sk-[A-Za-z0-9_-]{20,}$/, distinctive: true },
  CESIUM_ION_TOKEN: {
    re: /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    distinctive: true,
    check: (value) => {
      const claims = decodeJwtClaims(value);
      return Boolean(claims && 'jti' in claims && 'id' in claims);
    },
  },
  AISSTREAM_API_KEY: { re: /^[0-9a-f]{40}$/i },
  FIRMS_MAP_KEY: { re: /^[0-9a-f]{32}$/i },
  TOMTOM_API_KEY: { re: /^[A-Za-z0-9]{32}$/ },
  OPENSKY_CLIENT_ID: { re: /^[\w.@+-]{2,}-api-client$/, distinctive: true },
  OPENSKY_CLIENT_SECRET: { re: /^[A-Za-z0-9_-]{24,64}$/ },
  LL2_API_TOKEN: { re: /^[0-9a-f]{40}$/i },
  OWM_API_KEY: { re: /^[0-9a-f]{32}$/i },
  WAQI_TOKEN: { re: /^[0-9a-f]{40}$/i },
  OPENAIP_API_KEY: { re: /^[A-Za-z0-9_-]{16,64}$/ },
  THUNDERFOREST_API_KEY: { re: /^[0-9a-f]{32}$/i },
  WINDY_WEBCAMS_API_KEY: { re: /^[A-Za-z0-9_-]{16,64}$/ },
  SPACETRACK_IDENTITY: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  SPACETRACK_PASSWORD: { re: /^\S{8,}$/ },
});

/** Decode a JWT's claims without verifying it (shape detection only). */
export function decodeJwtClaims(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

/** "…k3Y9" — the only form of a credential a report may show. */
export function maskKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= 8) return '…' + '•'.repeat(Math.min(4, text.length));
  return `…${text.slice(-4)}`;
}

/** Normalize a clipboard/terminal string into a key candidate, or null. */
export function cleanCandidate(raw) {
  let text = String(raw ?? '').trim();
  // Accept `NAME=value`, quoted values and a trailing newline from a copy.
  const assignment = /^(?:export\s+)?[A-Z][A-Z0-9_]*\s*=\s*(.*)$/.exec(text);
  if (assignment) text = assignment[1].trim();
  text = text.replace(/^(['"])(.*)\1$/, '$2').trim();
  if (!text || text.length > 512 || /\s/.test(text)) return null;
  if (!/^[\x21-\x7e]+$/.test(text)) return null;
  return text;
}

/** Does `value` look like a credential for `envVar`? */
export function matchesShape(envVar, value) {
  const shape = KEY_SHAPES[envVar];
  if (!shape) return /^[A-Za-z0-9_.-]{16,200}$/.test(String(value));
  if (!shape.re.test(String(value))) return false;
  return shape.check ? shape.check(value) : true;
}

/**
 * Decide which env var a clipboard value belongs to.
 * @param {string} raw clipboard text
 * @param {{expected?: string|null, missing?: Iterable<string>}} context
 * @returns {{envVar: string, value: string, reason: 'distinctive'|'expected'} | null}
 */
export function classifyCandidate(raw, { expected = null, missing = [] } = {}) {
  const value = cleanCandidate(raw);
  if (!value) return null;
  const open = new Set(missing);
  for (const [envVar, shape] of Object.entries(KEY_SHAPES)) {
    if (!shape.distinctive || !open.has(envVar)) continue;
    if (matchesShape(envVar, value))
      return { envVar, value, reason: 'distinctive' };
  }
  if (expected && matchesShape(expected, value))
    return { envVar: expected, value, reason: 'expected' };
  return null;
}

/** Registry entries, in wizard order, with their per-var presence. */
export function wizardEntries(env = {}) {
  return KEY_SETUP_KEYS.map((entry) => {
    const vars = entry.envVars.map((name) => ({
      name,
      set: String(env[name] ?? '').trim() !== '',
    }));
    return { ...entry, vars, set: vars.every((v) => v.set) };
  });
}

/** Every env var the wizard manages (provider keys + generated secrets). */
export function wizardEnvVars() {
  const names = new Set();
  for (const entry of KEY_SETUP_KEYS)
    for (const name of entry.envVars) names.add(name);
  for (const secret of GENERATED_SECRETS) names.add(secret.envVar);
  return names;
}

/**
 * Same character rules Provider Settings applies (validateKeySetupUpdates):
 * values that would not round-trip through an unquoted dotenv line are
 * refused rather than written wrong.
 */
export function isWritableValue(value) {
  const text = String(value ?? '').trim();
  return (
    text.length > 0 &&
    text.length <= 512 &&
    /^[\x21-\x7e]+$/.test(text) &&
    !/[#"'$\\`]/.test(text)
  );
}

/**
 * Plan an import from other installs' env files: for each managed var unset
 * here, take the first writable value found, in source order.
 * @param {Record<string,string|undefined>} current
 * @param {{label: string, env: Record<string,string|undefined>}[]} sources
 * @returns {{envVar: string, value: string, from: string}[]}
 */
export function planImport(current, sources) {
  const plan = [];
  for (const envVar of wizardEnvVars()) {
    if (String(current[envVar] ?? '').trim()) continue;
    for (const source of sources) {
      const value = String(source.env?.[envVar] ?? '').trim();
      if (value && isWritableValue(value)) {
        plan.push({ envVar, value, from: source.label });
        break;
      }
    }
  }
  return plan;
}

// ── Live validation ──────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 9000;

/**
 * One probe per registry entry. Each returns a request description; the
 * verdict function maps the response to 'valid' | 'invalid' | 'unverified'
 * plus an optional note. Requests only ever go to the provider that issued
 * the credential.
 */
export const KEY_PROBES = Object.freeze({
  'google-maps': ({ GOOGLE_MAPS_API_KEY: key }) => ({
    url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
    // Browser keys are usually referrer-restricted to the dev server.
    headers: { Referer: 'http://localhost:4173/' },
    verdict: (status, body) => {
      if (status === 200) return { result: 'valid' };
      if (/referer|referrer/i.test(body))
        return {
          result: 'unverified',
          note: 'key is referrer-restricted; it will work from the app',
        };
      if (
        status === 404 ||
        /Map Tiles API has not been used|is disabled|SERVICE_DISABLED/i.test(
          body,
        )
      )
        return {
          result: 'invalid',
          note: 'key exists but 3D tiles are refused — enable the Map Tiles API and billing on its Google Cloud project',
        };
      if ([400, 401, 403].includes(status)) return { result: 'invalid' };
      return { result: 'unverified', note: `HTTP ${status}` };
    },
  }),
  openai: ({ OPENAI_API_KEY: key }) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
    verdict: (status) =>
      status === 200
        ? { result: 'valid' }
        : status === 429
          ? { result: 'valid', note: 'rate limited or out of credit' }
          : status === 401
            ? { result: 'invalid' }
            : { result: 'unverified', note: `HTTP ${status}` },
  }),
  aisstream: ({ AISSTREAM_API_KEY: key }) => ({
    websocket: 'wss://stream.aisstream.io/v0/stream',
    message: JSON.stringify({
      APIKey: key,
      BoundingBoxes: [
        [
          [-90, -180],
          [90, 180],
        ],
      ],
      FilterMessageTypes: ['PositionReport'],
    }),
    verdict: (event) =>
      event.type === 'message'
        ? /error/i.test(event.data) && !/MessageType/.test(event.data)
          ? { result: 'invalid', note: String(event.data).slice(0, 80) }
          : { result: 'valid' }
        : event.type === 'close' && event.early
          ? { result: 'invalid', note: 'stream closed immediately' }
          : { result: 'unverified', note: 'no stream data before timeout' },
  }),
  firms: ({ FIRMS_MAP_KEY: key }) => ({
    url: `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${encodeURIComponent(key)}`,
    verdict: (status, body) =>
      status === 200 && /transaction_limit/i.test(body)
        ? { result: 'valid' }
        : /invalid/i.test(body)
          ? { result: 'invalid' }
          : { result: 'unverified', note: `HTTP ${status}` },
  }),
  tomtom: ({ TOMTOM_API_KEY: key }) => ({
    url: `https://api.tomtom.com/search/2/geocode/London.json?limit=1&key=${encodeURIComponent(key)}`,
    verdict: statusVerdict,
  }),
  'cesium-ion': ({ CESIUM_ION_TOKEN: key }) => ({
    url: `https://api.cesium.com/v1/assets/1/endpoint?access_token=${encodeURIComponent(key)}`,
    verdict: (status) =>
      status === 200 || status === 404
        ? { result: 'valid' }
        : status === 401
          ? { result: 'invalid' }
          : { result: 'unverified', note: `HTTP ${status}` },
  }),
  opensky: ({ OPENSKY_CLIENT_ID: id, OPENSKY_CLIENT_SECRET: secret }) => ({
    url: 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }).toString(),
    verdict: (status) =>
      status === 200
        ? { result: 'valid' }
        : [400, 401].includes(status)
          ? { result: 'invalid' }
          : { result: 'unverified', note: `HTTP ${status}` },
  }),
  'launch-library': ({ LL2_API_TOKEN: key }) => ({
    url: 'https://ll.thespacedevs.com/2.3.0/api-throttle/',
    headers: { Authorization: `Token ${key}` },
    verdict: statusVerdict,
  }),
  openweathermap: ({ OWM_API_KEY: key }) => ({
    url: `https://api.openweathermap.org/data/2.5/weather?lat=0&lon=0&appid=${encodeURIComponent(key)}`,
    verdict: (status) =>
      status === 200
        ? { result: 'valid' }
        : status === 401
          ? {
              result: 'unverified',
              note: 'rejected — brand-new OpenWeatherMap keys take up to 2 h to activate',
            }
          : { result: 'unverified', note: `HTTP ${status}` },
  }),
  waqi: ({ WAQI_TOKEN: key }) => ({
    url: `https://api.waqi.info/feed/here/?token=${encodeURIComponent(key)}`,
    verdict: (status, body) =>
      /"status"\s*:\s*"ok"/.test(body)
        ? { result: 'valid' }
        : /invalid key/i.test(body)
          ? { result: 'invalid' }
          : { result: 'unverified', note: `HTTP ${status}` },
  }),
  openaip: ({ OPENAIP_API_KEY: key }) => ({
    url: 'https://api.core.openaip.net/api/airports?limit=1',
    headers: { 'x-openaip-api-key': key },
    verdict: statusVerdict,
  }),
  thunderforest: ({ THUNDERFOREST_API_KEY: key }) => ({
    url: `https://tile.thunderforest.com/transport/0/0/0.png?apikey=${encodeURIComponent(key)}`,
    verdict: statusVerdict,
  }),
  'windy-webcams': ({ WINDY_WEBCAMS_API_KEY: key }) => ({
    url: 'https://api.windy.com/webcams/api/v3/webcams?limit=1',
    headers: { 'x-windy-api-key': key },
    verdict: statusVerdict,
  }),
  spacetrack: ({
    SPACETRACK_IDENTITY: identity,
    SPACETRACK_PASSWORD: password,
  }) => ({
    url: 'https://www.space-track.org/ajaxauth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ identity, password }).toString(),
    verdict: (status, body) =>
      /Login.{0,4}Failed/i.test(body)
        ? { result: 'invalid' }
        : status === 200
          ? { result: 'valid' }
          : { result: 'unverified', note: `HTTP ${status}` },
  }),
});

function statusVerdict(status) {
  if (status === 200) return { result: 'valid' };
  if ([401, 403].includes(status)) return { result: 'invalid' };
  return { result: 'unverified', note: `HTTP ${status}` };
}

/**
 * Validate one registry entry against its provider.
 * @param {string} id registry id
 * @param {Record<string,string>} values env values for the entry's vars
 * @param {{fetchImpl?: typeof fetch, WebSocketImpl?: any, timeoutMs?: number}} deps
 * @returns {Promise<{id: string, result: 'valid'|'invalid'|'unverified'|'skipped', note?: string}>}
 */
export async function probeKey(id, values, deps = {}) {
  const build = KEY_PROBES[id];
  if (!build) return { id, result: 'skipped', note: 'no live check' };
  const spec = build(values);
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  try {
    if (spec.websocket)
      return { id, ...(await probeSocket(spec, deps, timeoutMs)) };
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(spec.url, {
      method: spec.method ?? 'GET',
      headers: {
        'User-Agent': 'gods-eye-view key wizard',
        ...(spec.headers ?? {}),
      },
      body: spec.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = response.headers?.get?.('content-type') ?? '';
    const body = /image|octet-stream/.test(contentType)
      ? ''
      : (await response.text().catch(() => '')).slice(0, 4000);
    return { id, ...spec.verdict(response.status, body) };
  } catch (error) {
    return {
      id,
      result: 'unverified',
      note: error?.name === 'TimeoutError' ? 'timed out' : 'network error',
    };
  }
}

function probeSocket(spec, deps, timeoutMs) {
  const WebSocketImpl = deps.WebSocketImpl ?? globalThis.WebSocket;
  if (!WebSocketImpl)
    return Promise.resolve({ result: 'unverified', note: 'no WebSocket' });
  return new Promise((resolve) => {
    const opened = Date.now();
    let done = false;
    let socket;
    const finish = (event) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.close?.();
      } catch {
        /* already closed */
      }
      resolve(spec.verdict(event));
    };
    const timer = setTimeout(() => finish({ type: 'timeout' }), timeoutMs);
    try {
      socket = new WebSocketImpl(spec.websocket);
    } catch {
      finish({ type: 'error' });
      return;
    }
    socket.addEventListener('open', () => socket.send(spec.message));
    socket.addEventListener('message', (event) =>
      finish({ type: 'message', data: String(event.data ?? '') }),
    );
    socket.addEventListener('close', () =>
      finish({ type: 'close', early: Date.now() - opened < timeoutMs / 2 }),
    );
    socket.addEventListener('error', () => finish({ type: 'error' }));
  });
}

/** Which registry entry owns an env var. */
export function entryForEnvVar(envVar) {
  return KEY_SETUP_KEYS.find((entry) => entry.envVars.includes(envVar)) ?? null;
}
