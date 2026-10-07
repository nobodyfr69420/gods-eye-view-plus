import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { validateSpaceWeatherSnapshot, OVATION_CELLS } from './records.js';

const SUMMARY_LIMIT = 512 * 1024;
const AURORA_LIMIT = 512 * 1024;

/** Decode the provider's base64 OVATION grid without Node or DOM helpers. */
export function decodeOvationGrid(base64) {
  if (typeof base64 !== 'string' || base64.length > 200_000) return null;
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.length === OVATION_CELLS ? out : null;
}

/**
 * Validate an aurora snapshot body.
 * @param {unknown} value `/api/space-weather/aurora` body.
 */
export function validateAuroraSnapshot(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
    throw new Error('Malformed aurora snapshot');
  const grid = value.unavailable ? null : decodeOvationGrid(value.grid);
  const time = (v) => (Number.isFinite(v) ? v : null);
  return {
    schemaVersion: 1,
    source: 'NOAA SWPC OVATION Prime',
    fetchedAt: time(value.fetchedAt),
    observedAt: time(value.observedAt),
    forecastAt: time(value.forecastAt),
    stale: value.stale === true,
    unavailable: !grid,
    reason: !grid
      ? typeof value.reason === 'string'
        ? value.reason.slice(0, 120)
        : 'OVATION aurora forecast unavailable'
      : null,
    grid,
  };
}

/**
 * NOAA SWPC readouts and the OVATION aurora grid from the local cache.
 * @param {{fetchImpl?: Function}} [options]
 */
export function createSpaceWeatherSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function read(path, limit, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(path, { signal });
    if (!response.ok) throw new Error(`SWPC HTTP ${response.status}`);
    const payload = await readResponseJsonCapped(response, limit, signal);
    signal?.throwIfAborted();
    return payload;
  }
  return {
    async getSnapshot({ signal } = {}) {
      return validateSpaceWeatherSnapshot(
        await read('/api/space-weather', SUMMARY_LIMIT, signal),
      );
    },
    async getAurora({ signal } = {}) {
      return validateAuroraSnapshot(
        await read('/api/space-weather/aurora', AURORA_LIMIT, signal),
      );
    },
  };
}
