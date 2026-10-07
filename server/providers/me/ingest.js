/**
 * ME layer ingest — pure parsers from the location formats of the phone apps a
 * person can point at their OWN server, into one fix shape:
 *
 *   { device, t, lat, lon, alt?, acc?, spd?, hdg?, batt?, src }
 *     t    epoch ms           alt  metres          acc  horizontal metres
 *     spd  metres per second  hdg  degrees true    batt percent 0..100
 *
 * Supported: OwnTracks (HTTP mode), Overland (iOS/Android batches), the
 * OsmAnd/Traccar query protocol (Traccar Client, GPSLogger custom URL) and the
 * app's own browser Geolocation fixes. Anything malformed is dropped, never
 * guessed at.
 */

const KNOT_MS = 0.514444;
const TEN_YEARS_MS = 10 * 365.25 * 86_400_000;
const ONE_DAY_MS = 86_400_000;

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Device names are labels the owner picks; keep them short and printable. */
export function sanitizeDevice(value, fallback = 'phone') {
  const text = String(value ?? '')
    .replace(/[^A-Za-z0-9 _.@-]/g, '')
    .trim()
    .slice(0, 40);
  return text || fallback;
}

/** Epoch seconds, epoch ms or an ISO string → epoch ms, or null. */
export function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n))
    return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/** Validate ranges and round; returns a clean fix or null. */
export function normalizeFix(raw, now = Date.now()) {
  const lat = num(raw?.lat);
  const lon = num(raw?.lon);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null; // the classic "no fix yet" report
  const t = parseTimestamp(raw.t) ?? now;
  if (t < now - TEN_YEARS_MS || t > now + ONE_DAY_MS) return null;
  const fix = {
    device: sanitizeDevice(raw.device),
    t,
    lat: Math.round(lat * 1e7) / 1e7,
    lon: Math.round(lon * 1e7) / 1e7,
    src: String(raw.src || 'unknown').slice(0, 20),
  };
  const alt = num(raw.alt);
  if (alt !== null && alt > -500 && alt < 100_000)
    fix.alt = Math.round(alt * 10) / 10;
  const acc = num(raw.acc);
  if (acc !== null && acc >= 0 && acc < 1e6)
    fix.acc = Math.round(acc * 10) / 10;
  const spd = num(raw.spd);
  if (spd !== null && spd >= 0 && spd < 400)
    fix.spd = Math.round(spd * 100) / 100;
  const hdg = num(raw.hdg);
  if (hdg !== null && hdg >= 0 && hdg <= 360) fix.hdg = Math.round(hdg);
  let batt = num(raw.batt);
  if (batt !== null && batt > 0 && batt <= 1 && raw.battFraction) batt *= 100;
  if (batt !== null && batt >= 0 && batt <= 100) fix.batt = Math.round(batt);
  return fix;
}

/** OwnTracks HTTP payload → fix (only `_type: location` carries one). */
export function fixFromOwnTracks(
  body,
  { device = null, now = Date.now() } = {},
) {
  if (!body || typeof body !== 'object' || body._type !== 'location')
    return null;
  const vel = num(body.vel); // km/h
  return normalizeFix(
    {
      device: device || body.tid || 'phone',
      t: body.tst,
      lat: body.lat,
      lon: body.lon,
      alt: body.alt,
      acc: body.acc,
      spd: vel === null ? null : vel / 3.6,
      hdg: body.cog,
      batt: body.batt,
      src: 'owntracks',
    },
    now,
  );
}

/**
 * OsmAnd / Traccar query parameters → fix. `speed` is knots in this protocol
 * (Traccar Client); GPSLogger users send metres per second as `spd_ms`.
 */
export function fixFromOsmAnd(params, { now = Date.now() } = {}) {
  const get = (name) =>
    typeof params?.get === 'function' ? params.get(name) : params?.[name];
  let lat = get('lat');
  let lon = get('lon');
  const location = get('location'); // Traccar Client 8+: "lat,lon"
  if ((lat === null || lat === undefined) && location) {
    [lat, lon] = String(location).split(',');
  }
  const knots = num(get('speed'));
  const ms = num(get('spd_ms'));
  return normalizeFix(
    {
      device: get('id') || get('deviceid') || 'phone',
      t: get('timestamp') ?? get('time'),
      lat,
      lon,
      alt: get('altitude') ?? get('alt'),
      acc: get('accuracy') ?? get('hdop'),
      spd: ms ?? (knots === null ? null : knots * KNOT_MS),
      hdg: get('bearing') ?? get('heading'),
      batt: get('batt') ?? get('battery'),
      src: 'osmand',
    },
    now,
  );
}

/** Overland batch → fixes. */
export function fixesFromOverland(
  body,
  { device = null, now = Date.now() } = {},
) {
  const locations = Array.isArray(body?.locations) ? body.locations : [];
  const fixes = [];
  for (const feature of locations.slice(0, 5000)) {
    const [lon, lat] = Array.isArray(feature?.geometry?.coordinates)
      ? feature.geometry.coordinates
      : [];
    const p = feature?.properties || {};
    const fix = normalizeFix(
      {
        device: device || p.device_id || 'phone',
        t: p.timestamp,
        lat,
        lon,
        alt: p.altitude,
        acc: p.horizontal_accuracy,
        spd: num(p.speed) !== null && num(p.speed) >= 0 ? p.speed : null,
        hdg: num(p.course) !== null && num(p.course) >= 0 ? p.course : null,
        batt: p.battery_level,
        battFraction: true,
        src: 'overland',
      },
      now,
    );
    if (fix) fixes.push(fix);
  }
  return fixes;
}

/** The app's own Geolocation fixes (one or a short batch). */
export function fixesFromBrowser(body, { now = Date.now() } = {}) {
  const list = Array.isArray(body?.fixes) ? body.fixes : [body];
  const fixes = [];
  for (const item of list.slice(0, 500)) {
    const fix = normalizeFix(
      {
        device: item?.device || 'browser',
        t: item?.t,
        lat: item?.lat,
        lon: item?.lon,
        alt: item?.alt,
        acc: item?.acc,
        spd: item?.spd,
        hdg: item?.hdg,
        src: 'browser',
      },
      now,
    );
    if (fix) fixes.push(fix);
  }
  return fixes;
}

/** Credential from Basic auth (password), Bearer, X-Me-Token or ?token=. */
export function ingestCredential(headers = {}, params = null) {
  const auth = String(headers.authorization || '');
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(auth);
  if (basic) {
    try {
      const decoded = atob(basic[1]);
      const colon = decoded.indexOf(':');
      if (colon >= 0)
        return {
          token: decoded.slice(colon + 1),
          user: decoded.slice(0, colon),
        };
    } catch {
      /* fall through */
    }
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth);
  if (bearer) return { token: bearer[1], user: null };
  if (headers['x-me-token'])
    return { token: String(headers['x-me-token']), user: null };
  const fromQuery = params?.get?.('token');
  return { token: fromQuery ? String(fromQuery) : '', user: null };
}
