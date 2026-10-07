/**
 * ME — pure track maths over fixes `{device, t, lat, lon, alt?, acc?, spd?, hdg?}`
 * sorted by time. No Cesium, no DOM.
 */

const R = 6_371_008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a → b in degrees. */
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Drop fixes too inaccurate to trust (accuracy worse than `maxAcc` m). */
export const usable = (fixes, maxAcc = 250) =>
  fixes.filter((f) => !(Number.isFinite(f.acc) && f.acc > maxAcc));

/**
 * Split a device's fixes into continuous segments: a gap longer than
 * `gapMs` or a jump implying more than `maxSpeed` m/s starts a new one.
 */
export function segments(fixes, { gapMs = 15 * 60_000, maxSpeed = 350 } = {}) {
  const out = [];
  let current = [];
  for (const fix of fixes) {
    const prev = current[current.length - 1];
    if (prev) {
      const dt = (fix.t - prev.t) / 1000;
      const jump = distanceM(prev, fix);
      if (fix.t - prev.t > gapMs || (dt > 0 && jump / dt > maxSpeed)) {
        if (current.length > 1) out.push(current);
        current = [];
      }
    }
    current.push(fix);
  }
  if (current.length > 1) out.push(current);
  return out;
}

/** Douglas–Peucker-ish thinning by minimum spacing (fast, order-preserving). */
export function thin(fixes, minSpacingM = 5, maxPoints = 20_000) {
  if (fixes.length <= 2) return fixes.slice();
  let spacing = minSpacingM;
  let out;
  do {
    out = [fixes[0]];
    for (let i = 1; i < fixes.length - 1; i++)
      if (distanceM(out[out.length - 1], fixes[i]) >= spacing)
        out.push(fixes[i]);
    out.push(fixes[fixes.length - 1]);
    spacing *= 2;
  } while (out.length > maxPoints);
  return out;
}

/**
 * Totals for a list of fixes from one device: distance, moving time, max and
 * average moving speed, elevation gain. Movement is counted only between
 * fixes less than `gapMs` apart and faster than `movingMs` m/s, so GPS
 * jitter while standing still does not add phantom kilometres.
 */
export function trackStats(
  fixes,
  { gapMs = 15 * 60_000, movingMs = 0.6 } = {},
) {
  let distance = 0;
  let movingMs_ = 0;
  let maxSpeed = 0;
  let gain = 0;
  const clean = usable(fixes);
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1];
    const b = clean[i];
    const dtMs = b.t - a.t;
    if (dtMs <= 0 || dtMs > gapMs) continue;
    const d = distanceM(a, b);
    const speed = d / (dtMs / 1000);
    if (speed > 350) continue; // teleport / bad fix
    const jitter = Math.max(a.acc ?? 10, b.acc ?? 10) * 0.5;
    if (speed >= movingMs && d > jitter) {
      distance += d;
      movingMs_ += dtMs;
      maxSpeed = Math.max(maxSpeed, Number.isFinite(b.spd) ? b.spd : speed);
    }
    if (Number.isFinite(a.alt) && Number.isFinite(b.alt) && b.alt - a.alt > 1)
      gain += b.alt - a.alt;
  }
  return {
    fixes: fixes.length,
    distanceM: distance,
    movingMs: movingMs_,
    maxSpeedMs: maxSpeed,
    avgSpeedMs: movingMs_ > 0 ? distance / (movingMs_ / 1000) : 0,
    gainM: gain,
    first: fixes[0]?.t ?? null,
    last: fixes[fixes.length - 1]?.t ?? null,
  };
}

/**
 * Stay points: places where the device remained within `radiusM` for at
 * least `minMs`. Returns [{lat, lon, start, end, dwellMs, n}].
 */
export function stays(fixes, { radiusM = 120, minMs = 10 * 60_000 } = {}) {
  const out = [];
  const clean = usable(fixes, 400);
  let i = 0;
  while (i < clean.length) {
    let j = i + 1;
    let sumLat = clean[i].lat;
    let sumLon = clean[i].lon;
    while (j < clean.length) {
      const center = { lat: sumLat / (j - i), lon: sumLon / (j - i) };
      if (distanceM(center, clean[j]) > radiusM) break;
      sumLat += clean[j].lat;
      sumLon += clean[j].lon;
      j++;
    }
    const start = clean[i].t;
    const end = clean[j - 1].t;
    if (end - start >= minMs) {
      out.push({
        lat: sumLat / (j - i),
        lon: sumLon / (j - i),
        start,
        end,
        dwellMs: end - start,
        n: j - i,
      });
      i = j;
    } else i++;
  }
  return out;
}

/** Merge stays at the same place into "places" ranked by total time. */
export function places(stayList, { radiusM = 150 } = {}) {
  const out = [];
  for (const stay of stayList) {
    const hit = out.find((p) => distanceM(p, stay) <= radiusM);
    if (hit) {
      const w = hit.dwellMs + stay.dwellMs;
      hit.lat = (hit.lat * hit.dwellMs + stay.lat * stay.dwellMs) / w;
      hit.lon = (hit.lon * hit.dwellMs + stay.lon * stay.dwellMs) / w;
      hit.dwellMs = w;
      hit.visits++;
      hit.last = Math.max(hit.last, stay.end);
    } else {
      out.push({
        lat: stay.lat,
        lon: stay.lon,
        dwellMs: stay.dwellMs,
        visits: 1,
        last: stay.end,
      });
    }
  }
  return out.sort((a, b) => b.dwellMs - a.dwellMs);
}

/** Group fixes by device (each list stays time-sorted). */
export function byDevice(fixes) {
  const map = new Map();
  for (const fix of fixes) {
    if (!map.has(fix.device)) map.set(fix.device, []);
    map.get(fix.device).push(fix);
  }
  for (const list of map.values()) list.sort((a, b) => a.t - b.t);
  return map;
}

/** A stable, distinct color per device name. */
export function deviceColor(device) {
  const palette = [
    '#00ff9c',
    '#00d4ff',
    '#ffb020',
    '#ff8ad8',
    '#c0a6ff',
    '#8fd14f',
    '#ff6b3d',
    '#ffe082',
  ];
  let h = 0;
  for (const ch of String(device)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/** "1.2 km", "830 m". */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '—';
  return m >= 1000
    ? `${(m / 1000).toFixed(m >= 100_000 ? 0 : 1)} km`
    : `${Math.round(m)} m`;
}

/** "2 h 05 m", "12 m". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 m';
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 48) return `${Math.round(h / 24)} d`;
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}

/** Compass point for a heading. */
export function compass(deg) {
  if (!Number.isFinite(deg)) return '—';
  const names = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return `${names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]} ${Math.round(deg)}°`;
}
