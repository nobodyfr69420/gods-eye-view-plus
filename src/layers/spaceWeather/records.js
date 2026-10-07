/**
 * @module spaceWeather/records
 * @description Pure parsers for the NOAA SWPC public JSON products used by the
 * Space Weather and Aurora layers. Shared by the Node provider (which reduces
 * the raw products) and the browser source (which validates the reduced
 * snapshot). No Cesium, DOM or Node imports.
 *
 * SWPC has published several of its `products/*.json` feeds both as
 * "header row + string rows" arrays and as arrays of objects; every tabular
 * parser here accepts either shape.
 */

export const SWPC_ORIGIN = 'https://services.swpc.noaa.gov';
export const SWPC_URLS = Object.freeze({
  kp: `${SWPC_ORIGIN}/products/noaa-planetary-k-index.json`,
  kp1m: `${SWPC_ORIGIN}/json/planetary_k_index_1m.json`,
  plasma: `${SWPC_ORIGIN}/products/solar-wind/plasma-2-hour.json`,
  mag: `${SWPC_ORIGIN}/products/solar-wind/mag-2-hour.json`,
  xray: `${SWPC_ORIGIN}/json/goes/primary/xrays-6-hour.json`,
  alerts: `${SWPC_ORIGIN}/products/alerts.json`,
  scales: `${SWPC_ORIGIN}/products/noaa-scales.json`,
  ovation: `${SWPC_ORIGIN}/json/ovation_aurora_latest.json`,
});

/** OVATION grid: 360 longitudes (0..359 E) × 181 latitudes (-90..90). */
export const OVATION_COLUMNS = 360;
export const OVATION_ROWS = 181;
export const OVATION_CELLS = OVATION_COLUMNS * OVATION_ROWS;

const MAX_ALERTS = 25;
const MAX_ALERT_TEXT = 1600;

/**
 * Parse an SWPC time tag (`2026-10-07 03:00:00.000`, `2026-10-07T03:00:00`,
 * or full ISO with a zone). Tags without a zone are UTC.
 * @param {unknown} value
 * @returns {number|null} Epoch milliseconds.
 */
export function parseSwpcTime(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const trimmed = value.trim();
  if (
    !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:?\d\d)?$/.test(
      trimmed,
    )
  )
    return null;
  let iso = trimmed.replace(' ', 'T');
  if (!/(?:Z|[+-]\d\d:?\d\d)$/.test(iso)) iso += 'Z';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function finite(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/**
 * Normalize a tabular SWPC product into plain objects.
 * @param {unknown} payload Array of rows (first row = header) or of objects.
 * @returns {Array<object>}
 */
export function swpcRows(payload) {
  if (!Array.isArray(payload) || payload.length === 0) return [];
  if (Array.isArray(payload[0])) {
    const header = payload[0].map((key) => String(key));
    return payload.slice(1).flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const out = {};
      header.forEach((key, index) => {
        out[key] = row[index];
      });
      return [out];
    });
  }
  return payload.filter(
    (row) => row && typeof row === 'object' && !Array.isArray(row),
  );
}

/** NOAA G-scale for a planetary Kp value (G1 = Kp 5 … G5 = Kp 9). */
export function kpToGScale(kp) {
  if (!Number.isFinite(kp) || kp < 5) return 0;
  return Math.min(5, Math.floor(kp) - 4);
}

/**
 * Latest and recent 3-hour planetary Kp.
 * @param {unknown} payload `noaa-planetary-k-index.json`.
 * @returns {{latest: {at: number, kp: number}|null, max24h: number|null, series: Array<{at:number,kp:number}>}}
 */
export function parseKpProduct(payload) {
  const series = [];
  for (const row of swpcRows(payload)) {
    const at = parseSwpcTime(row.time_tag);
    const kp = finite(row.Kp ?? row.kp ?? row.kp_index, 0, 9);
    if (at !== null && kp !== null) series.push({ at, kp });
  }
  series.sort((a, b) => a.at - b.at);
  const latest = series.at(-1) || null;
  const recent = latest
    ? series.filter((row) => latest.at - row.at < 24 * 3600_000)
    : [];
  return {
    latest,
    max24h: recent.length ? Math.max(...recent.map((row) => row.kp)) : null,
    series: series.slice(-24),
  };
}

/**
 * Latest one-minute estimated Kp.
 * @param {unknown} payload `planetary_k_index_1m.json`.
 * @returns {{at:number, kp:number}|null}
 */
export function parseKpEstimate(payload) {
  let best = null;
  for (const row of swpcRows(payload)) {
    const at = parseSwpcTime(row.time_tag);
    const kp = finite(row.estimated_kp ?? row.kp_index, 0, 9);
    if (at !== null && kp !== null && (!best || at > best.at))
      best = { at, kp };
  }
  return best;
}

function latestRow(payload, fields) {
  let best = null;
  for (const row of swpcRows(payload)) {
    const at = parseSwpcTime(row.time_tag);
    if (at === null) continue;
    const values = {};
    let any = false;
    for (const [key, [min, max]] of Object.entries(fields)) {
      values[key] = finite(row[key], min, max);
      if (values[key] !== null) any = true;
    }
    if (any && (!best || at > best.at)) best = { at, ...values };
  }
  return best;
}

/**
 * Latest DSCOVR/ACE real-time solar wind plasma and magnetic field.
 * @param {unknown} plasma `plasma-2-hour.json`.
 * @param {unknown} mag `mag-2-hour.json`.
 * @returns {{plasma: {at:number,speed:?number,density:?number,temperature:?number}|null, mag: {at:number,bz:?number,bt:?number}|null}}
 */
export function parseSolarWind(plasma, mag) {
  const p = latestRow(plasma, {
    speed: [0, 5000],
    density: [0, 1000],
    temperature: [0, 1e8],
  });
  const m = latestRow(mag, {
    bz_gsm: [-500, 500],
    bt: [0, 500],
  });
  return {
    plasma: p,
    mag: m ? { at: m.at, bz: m.bz_gsm, bt: m.bt } : null,
  };
}

/**
 * GOES flare class for a 0.1–0.8 nm flux in W/m².
 * @param {number} flux
 * @returns {string|null} e.g. `M2.3`.
 */
export function flareClass(flux) {
  if (!Number.isFinite(flux) || flux <= 0) return null;
  const bands = [
    ['X', 1e-4],
    ['M', 1e-5],
    ['C', 1e-6],
    ['B', 1e-7],
    ['A', 1e-8],
  ];
  for (const [letter, base] of bands) {
    if (flux >= base) {
      const scaled = Math.floor((flux / base) * 10) / 10;
      return `${letter}${scaled.toFixed(1)}`;
    }
  }
  return '<A1.0';
}

/** NOAA R-scale (radio blackout) for a 0.1–0.8 nm flux. */
export function xrayToRScale(flux) {
  if (!Number.isFinite(flux)) return 0;
  if (flux >= 2e-3) return 5;
  if (flux >= 1e-3) return 4;
  if (flux >= 1e-4) return 3;
  if (flux >= 5e-5) return 2;
  if (flux >= 1e-5) return 1;
  return 0;
}

/**
 * Latest and peak GOES long-channel (0.1–0.8 nm) X-ray flux.
 * @param {unknown} payload `xrays-6-hour.json`.
 * @returns {{latest: {at:number, flux:number, flareClass:string, satellite:?number}|null, peak6h: {at:number, flux:number, flareClass:string}|null}}
 */
export function parseXray(payload) {
  let latest = null;
  let peak = null;
  if (!Array.isArray(payload)) return { latest, peak6h: peak };
  for (const row of payload) {
    if (!row || typeof row !== 'object' || row.energy !== '0.1-0.8nm') continue;
    const at = parseSwpcTime(row.time_tag);
    const flux = finite(row.flux, 0, 1);
    if (at === null || flux === null || flux <= 0) continue;
    if (!latest || at > latest.at)
      latest = {
        at,
        flux,
        flareClass: flareClass(flux),
        satellite: finite(row.satellite, 0, 99),
      };
    if (!peak || flux > peak.flux)
      peak = { at, flux, flareClass: flareClass(flux) };
  }
  return { latest, peak6h: peak };
}

function cleanText(value, max) {
  return (
    String(value ?? '')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '')
      .trim()
      .slice(0, max)
  );
}

/**
 * Headline for an SWPC alert/watch/warning/summary message.
 * @param {string} message Full message text.
 * @returns {{kind: string, headline: string, code: string|null}}
 */
export function alertHeadline(message) {
  const text = String(message || '');
  const code =
    /Space Weather Message Code:\s*([A-Z0-9]+)/i.exec(text)?.[1] || null;
  const line =
    text
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) =>
        /^(?:CANCEL\s+)?(?:EXTENDED\s+)?(?:ALERT|WARNING|WATCH|SUMMARY|CANCELLATION)\b/i.test(
          entry,
        ),
      ) || '';
  const kind = /^CANCEL/i.test(line)
    ? 'cancel'
    : /WARNING/i.test(line)
      ? 'warning'
      : /WATCH/i.test(line)
        ? 'watch'
        : /SUMMARY/i.test(line)
          ? 'summary'
          : /ALERT/i.test(line)
            ? 'alert'
            : 'message';
  return {
    kind,
    headline: line.slice(0, 160) || code || 'SWPC message',
    code,
  };
}

/**
 * Most recent SWPC alerts, watches, warnings and summaries.
 * @param {unknown} payload `alerts.json`.
 * @returns {Array<{id:string, issuedAt:number, kind:string, headline:string, code:?string, text:string}>}
 */
export function parseAlerts(payload) {
  if (!Array.isArray(payload)) return [];
  const seen = new Set();
  const alerts = [];
  for (const row of payload) {
    if (!row || typeof row !== 'object') continue;
    const issuedAt = parseSwpcTime(row.issue_datetime);
    const text = cleanText(row.message, MAX_ALERT_TEXT);
    if (issuedAt === null || !text) continue;
    const product = cleanText(row.product_id, 16) || 'SWPC';
    const id = `${product}:${issuedAt}`;
    if (seen.has(id)) continue;
    seen.add(id);
    alerts.push({ id, issuedAt, ...alertHeadline(text), text });
  }
  return alerts
    .sort((a, b) => b.issuedAt - a.issuedAt || a.id.localeCompare(b.id))
    .slice(0, MAX_ALERTS);
}

function scaleEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const read = (key) => {
    const value = raw[key];
    const scale = finite(value?.Scale, 0, 5);
    return scale === null
      ? null
      : { scale, text: cleanText(value?.Text, 24) || null };
  };
  return { R: read('R'), S: read('S'), G: read('G') };
}

/**
 * NOAA space-weather scales: current (`0`) and last-24-hour maximum (`-1`).
 * @param {unknown} payload `noaa-scales.json`.
 */
export function parseScales(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return { current: null, past24h: null };
  return {
    current: scaleEntry(payload['0']),
    past24h: scaleEntry(payload['-1']),
  };
}

/**
 * Reduce the OVATION Prime aurora product to a dense probability grid.
 * Cell index = (latitude + 90) * 360 + longitude (0..359 east).
 * @param {unknown} payload `ovation_aurora_latest.json`.
 * @returns {{observedAt:number|null, forecastAt:number|null, grid: Uint8Array, cells: number}|null}
 */
export function parseOvation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const coordinates = payload.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 1000) return null;
  if (coordinates.length > OVATION_CELLS * 2) return null;
  const grid = new Uint8Array(OVATION_CELLS);
  let cells = 0;
  for (const entry of coordinates) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const lon = Math.round(Number(entry[0]));
    const lat = Math.round(Number(entry[1]));
    const value = Number(entry[2]);
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(value) ||
      lat < -90 ||
      lat > 90
    )
      continue;
    const column = ((lon % 360) + 360) % 360;
    grid[(lat + 90) * OVATION_COLUMNS + column] = Math.max(
      0,
      Math.min(100, Math.round(value)),
    );
    cells++;
  }
  if (cells < 1000) return null;
  return {
    observedAt: parseSwpcTime(payload['Observation Time']),
    forecastAt: parseSwpcTime(payload['Forecast Time']),
    grid,
    cells,
  };
}

/**
 * Probability of visible aurora at a location, from the dense grid.
 * @param {Uint8Array} grid
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number|null}
 */
export function ovationProbabilityAt(grid, latDeg, lonDeg) {
  if (
    !(grid instanceof Uint8Array) ||
    grid.length !== OVATION_CELLS ||
    !Number.isFinite(latDeg) ||
    !Number.isFinite(lonDeg)
  )
    return null;
  const row = Math.max(0, Math.min(180, Math.round(latDeg) + 90));
  const column = ((Math.round(lonDeg) % 360) + 360) % 360;
  return grid[row * OVATION_COLUMNS + column];
}

const time = (value) => (Number.isFinite(value) ? value : null);
const num = (value, min, max) =>
  Number.isFinite(value) && value >= min && value <= max ? value : null;

/**
 * Validate the provider's reduced snapshot in the browser. Anything outside
 * the contract is dropped to null rather than displayed.
 * @param {unknown} value `/api/space-weather` body.
 * @returns {object}
 */
export function validateSpaceWeatherSnapshot(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
    throw new Error('Malformed space-weather snapshot');
  const kp = value.kp && typeof value.kp === 'object' ? value.kp : {};
  const latestKp =
    kp.latest && time(kp.latest.at) !== null && num(kp.latest.kp, 0, 9) !== null
      ? { at: kp.latest.at, kp: kp.latest.kp }
      : null;
  const estimate =
    kp.estimate &&
    time(kp.estimate.at) !== null &&
    num(kp.estimate.kp, 0, 9) !== null
      ? { at: kp.estimate.at, kp: kp.estimate.kp }
      : null;
  const series = Array.isArray(kp.series)
    ? kp.series
        .filter((row) => time(row?.at) !== null && num(row?.kp, 0, 9) !== null)
        .slice(-24)
        .map((row) => ({ at: row.at, kp: row.kp }))
    : [];
  const wind =
    value.solarWind && typeof value.solarWind === 'object'
      ? value.solarWind
      : {};
  const plasma =
    wind.plasma && time(wind.plasma.at) !== null
      ? {
          at: wind.plasma.at,
          speed: num(wind.plasma.speed, 0, 5000),
          density: num(wind.plasma.density, 0, 1000),
          temperature: num(wind.plasma.temperature, 0, 1e8),
        }
      : null;
  const mag =
    wind.mag && time(wind.mag.at) !== null
      ? {
          at: wind.mag.at,
          bz: num(wind.mag.bz, -500, 500),
          bt: num(wind.mag.bt, 0, 500),
        }
      : null;
  const x = value.xray && typeof value.xray === 'object' ? value.xray : {};
  const xrayPoint = (point) =>
    point && time(point.at) !== null && num(point.flux, 0, 1) !== null
      ? { at: point.at, flux: point.flux, flareClass: flareClass(point.flux) }
      : null;
  const scale = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const one = (key) =>
      entry[key] && num(entry[key].scale, 0, 5) !== null
        ? {
            scale: entry[key].scale,
            text:
              typeof entry[key].text === 'string'
                ? entry[key].text.slice(0, 24)
                : null,
          }
        : null;
    return { R: one('R'), S: one('S'), G: one('G') };
  };
  const alerts = Array.isArray(value.alerts)
    ? value.alerts
        .filter(
          (alert) =>
            alert &&
            typeof alert.id === 'string' &&
            time(alert.issuedAt) !== null &&
            typeof alert.headline === 'string' &&
            typeof alert.text === 'string',
        )
        .slice(0, MAX_ALERTS)
        .map((alert) => ({
          id: alert.id.slice(0, 48),
          issuedAt: alert.issuedAt,
          kind: typeof alert.kind === 'string' ? alert.kind : 'message',
          headline: alert.headline.slice(0, 160),
          code: typeof alert.code === 'string' ? alert.code.slice(0, 16) : null,
          text: alert.text.slice(0, MAX_ALERT_TEXT),
        }))
    : [];
  const feeds =
    value.feeds && typeof value.feeds === 'object' ? value.feeds : {};
  return {
    schemaVersion: 1,
    source: 'NOAA SWPC',
    fetchedAt: time(value.fetchedAt),
    stale: value.stale === true,
    unavailable: value.unavailable === true,
    reason:
      typeof value.reason === 'string' ? value.reason.slice(0, 160) : null,
    kp: {
      latest: latestKp,
      estimate,
      max24h: num(kp.max24h, 0, 9),
      series,
    },
    solarWind: { plasma, mag },
    xray: {
      latest: xrayPoint(x.latest),
      peak6h: xrayPoint(x.peak6h),
    },
    scales: {
      current: scale(value.scales?.current),
      past24h: scale(value.scales?.past24h),
    },
    alerts,
    feeds: Object.fromEntries(
      Object.entries(feeds)
        .filter(([key]) => Object.hasOwn(SWPC_URLS, key))
        .map(([key, state]) => [key, state === 'ok' ? 'ok' : 'unavailable']),
    ),
  };
}
