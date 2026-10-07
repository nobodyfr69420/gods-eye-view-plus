import { readResponseTextCapped } from '../common/http.js';
import { createFeedCache, fetchJsonCapped, sendJson } from './feedCache.js';
import {
  SWPC_URLS,
  parseKpProduct,
  parseKpEstimate,
  parseSolarWind,
  parseXray,
  parseAlerts,
  parseScales,
  parseOvation,
} from '../../../src/layers/spaceWeather/records.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ATTRIBUTION = 'NOAA Space Weather Prediction Center (SWPC)';

/** Byte caps per fixed product; SWPC bodies are well below these. */
const CAPS = Object.freeze({
  kp: 256 * 1024,
  kp1m: 1024 * 1024,
  plasma: 256 * 1024,
  mag: 256 * 1024,
  xray: 1024 * 1024,
  alerts: 1024 * 1024,
  scales: 64 * 1024,
  ovation: 4 * 1024 * 1024,
});

/**
 * NOAA SWPC space-weather and OVATION aurora middleware.
 *
 * `GET /api/space-weather` reduces Kp, solar wind, GOES X-ray flux, NOAA
 * scales and recent alerts to one bounded snapshot. Each product refreshes at
 * most once per two minutes (SWPC updates most of them every 1–5 minutes) and
 * a failed product never blanks the products that did load.
 *
 * `GET /api/space-weather/aurora` serves the latest OVATION Prime grid as a
 * base64 360×181 byte grid (percent probability of visible aurora). It
 * refreshes at most every five minutes.
 *
 * Only fixed SWPC URLs are requested; no user input reaches a destination.
 * @param {{fetchImpl?: Function, now?: () => number}} [options]
 */
export function spaceWeatherProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const read = (key, parse) =>
    createFeedCache({
      ttlMs: 2 * MINUTE,
      staleMaxMs: 6 * HOUR,
      retryMs: MINUTE,
      now,
      load: async (signal) => {
        const parsed = parse(
          await fetchJsonCapped(
            fetchImpl,
            SWPC_URLS[key],
            CAPS[key],
            signal,
            readResponseTextCapped,
          ),
        );
        if (parsed === null) throw new Error(`malformed ${key}`);
        return parsed;
      },
    });
  const feeds = {
    kp: read('kp', parseKpProduct),
    kp1m: read('kp1m', parseKpEstimate),
    plasma: read('plasma', (raw) => raw),
    mag: read('mag', (raw) => raw),
    xray: read('xray', parseXray),
    alerts: read('alerts', parseAlerts),
    scales: read('scales', parseScales),
  };
  const aurora = createFeedCache({
    ttlMs: 5 * MINUTE,
    staleMaxMs: 3 * HOUR,
    retryMs: MINUTE,
    timeoutMs: 25_000,
    now,
    load: async (signal) => {
      const parsed = parseOvation(
        await fetchJsonCapped(
          fetchImpl,
          SWPC_URLS.ovation,
          CAPS.ovation,
          signal,
          readResponseTextCapped,
        ),
      );
      if (!parsed) throw new Error('malformed OVATION grid');
      return {
        observedAt: parsed.observedAt,
        forecastAt: parsed.forecastAt,
        cells: parsed.cells,
        grid: Buffer.from(parsed.grid).toString('base64'),
      };
    },
  });

  async function summary() {
    const keys = Object.keys(feeds);
    const results = await Promise.all(keys.map((key) => feeds[key].read()));
    const byKey = Object.fromEntries(keys.map((key, i) => [key, results[i]]));
    const loaded = results.filter((result) => result.value !== null);
    const wind = parseSolarWind(byKey.plasma.value, byKey.mag.value);
    const fetchedAt = loaded.length
      ? Math.min(...loaded.map((result) => result.fetchedAt))
      : null;
    return {
      schemaVersion: 1,
      source: 'NOAA SWPC',
      attribution: ATTRIBUTION,
      fetchedAt,
      stale: results.some((result) => result.stale),
      unavailable: loaded.length === 0,
      reason: loaded.length === 0 ? 'NOAA SWPC unavailable' : null,
      kp: {
        latest: byKey.kp.value?.latest ?? null,
        max24h: byKey.kp.value?.max24h ?? null,
        series: byKey.kp.value?.series ?? [],
        estimate: byKey.kp1m.value ?? null,
      },
      solarWind: wind,
      xray: byKey.xray.value ?? { latest: null, peak6h: null },
      scales: byKey.scales.value ?? { current: null, past24h: null },
      alerts: byKey.alerts.value ?? [],
      feeds: Object.fromEntries(
        keys.map((key) => [
          key,
          byKey[key].value !== null && !byKey[key].stale ? 'ok' : 'unavailable',
        ]),
      ),
    };
  }

  async function handler(req, res) {
    try {
      if (req.method !== 'GET')
        return sendJson(res, 405, { error: 'method_not_allowed' });
      const route = String(req.url || '/').split('?')[0];
      if (route === '/' || route === '')
        return sendJson(res, 200, await summary());
      if (route === '/aurora') {
        const result = await aurora.read();
        return sendJson(res, 200, {
          schemaVersion: 1,
          source: 'NOAA SWPC OVATION Prime',
          attribution: ATTRIBUTION,
          fetchedAt: result.fetchedAt,
          stale: result.stale,
          unavailable: result.value === null,
          reason:
            result.value === null
              ? 'OVATION aurora forecast unavailable'
              : null,
          ...(result.value ?? {}),
        });
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch {
      return sendJson(res, 500, { error: 'space_weather_error' });
    }
  }

  // Returns nothing: Vite runs a function returned here as a post hook.
  const install = ({ middlewares }) => {
    middlewares.use('/api/space-weather', handler);
  };
  return {
    name: 'space-weather',
    configureServer: install,
    configurePreviewServer: install,
  };
}
