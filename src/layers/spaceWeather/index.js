import {
  ALERT_WINDOWS,
  KP_BANDS,
  alertsInWindow,
  kpBand,
  spaceWeatherSummaryLines,
} from './model.js';
export { createSpaceWeatherSource } from './source.js';

export const SPACE_WEATHER_LAYER_ID = 'space-weather';

const utc = (ms) =>
  Number.isFinite(ms)
    ? `${new Date(ms).toISOString().slice(5, 16).replace('T', ' ')} UTC`
    : '—';

/**
 * Space Weather: NOAA SWPC readouts in the layer row — planetary Kp, real-time
 * solar wind at L1, GOES X-ray flux and flare class, NOAA R/S/G scales and the
 * recent alert/watch/warning stream. Draws nothing on the globe; pair it with
 * the Aurora Oval layer for the spatial view.
 * @param {{source: {getSnapshot: Function}, now?: () => number}} options
 */
export function createSpaceWeatherLayer({
  source,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Space weather requires an SWPC source');
  let snapshot = null;
  let enabled = false;
  let destroyed = false;
  let loading = false;
  let error = null;
  let request = null;
  let listener = null;
  let alertWindow = '24h';
  let selectedAlertId = null;

  const notify = () => {
    try {
      listener?.();
    } catch {
      /* panel listener failures stay in the panel */
    }
  };

  const layer = {
    id: SPACE_WEATHER_LAYER_ID,
    name: 'Space Weather',
    icon: '☀',
    source: 'NOAA SWPC',
    updateInterval: 2 * 60_000,

    init() {},

    enable() {
      if (!destroyed) enabled = true;
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      selectedAlertId = null;
      notify();
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || destroyed) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener?.('abort', abort, { once: true });
      loading = true;
      notify();
      try {
        const next = await source.getSnapshot({ signal: controller.signal });
        if (!enabled || controller.signal.aborted || request !== controller)
          return false;
        snapshot = next;
        error = next.unavailable
          ? next.reason || 'NOAA SWPC unavailable'
          : null;
        if (
          selectedAlertId &&
          !next.alerts.some((alert) => alert.id === selectedAlertId)
        )
          selectedAlertId = null;
        return true;
      } catch (cause) {
        if (controller.signal.aborted || request !== controller) return false;
        error = cause?.message || 'NOAA SWPC unavailable';
        return true;
      } finally {
        signal?.removeEventListener?.('abort', abort);
        if (request === controller) {
          request = null;
          loading = false;
          notify();
        }
      }
    },

    setParams(params = {}) {
      if (destroyed) return false;
      if (params.alertWindow !== undefined) {
        if (!Object.hasOwn(ALERT_WINDOWS, params.alertWindow)) return false;
        alertWindow = params.alertWindow;
      }
      if (params.alertId === null) selectedAlertId = null;
      else if (typeof params.alertId === 'string')
        selectedAlertId =
          selectedAlertId === params.alertId ? null : params.alertId;
      notify();
      return true;
    },

    getParams() {
      return { alertWindow };
    },

    getRowControls() {
      const t = now();
      const alerts = alertsInWindow(snapshot?.alerts, alertWindow, t);
      const selected = alerts.find((alert) => alert.id === selectedAlertId);
      const lines = snapshot
        ? spaceWeatherSummaryLines(snapshot, t)
        : [loading ? 'Loading NOAA SWPC…' : error || 'No data yet'];
      if (snapshot && !snapshot.unavailable)
        lines.push(
          alerts.length
            ? `${alerts.length} SWPC message${alerts.length === 1 ? '' : 's'} in the last ${alertWindow} — select one to read it`
            : `No SWPC alerts, watches or warnings in the last ${alertWindow}`,
        );
      if (selected) lines.push('', selected.text);
      const kp = snapshot?.kp?.latest?.kp;
      return {
        chips: Object.keys(ALERT_WINDOWS).map((key) => ({
          id: `window:${key}`,
          label: `ALERTS ${key.toUpperCase()}`,
          active: alertWindow === key,
          title: `Show SWPC alerts, watches and warnings issued in the last ${key}`,
          params: { alertWindow: key },
        })),
        legend: Number.isFinite(kp)
          ? KP_BANDS.map((band) => ({
              label: band === kpBand(kp) ? `${band.label} ◂ now` : band.label,
              color: band.color,
            }))
          : [],
        list: {
          ariaLabel: 'NOAA SWPC alerts, watches and warnings',
          items: alerts.slice(0, 12).map((alert, index) => ({
            id: alert.id,
            ordinal: index + 1,
            lead: alert.kind.toUpperCase(),
            text: `${utc(alert.issuedAt)} · ${alert.headline}`,
            active: alert.id === selectedAlertId,
            params: { alertId: alert.id },
          })),
        },
        info: lines.join('\n'),
        infoTitle:
          'NOAA Space Weather Prediction Center public JSON products. Kp is the 3-hour planetary index (the latest value can be preliminary); the 1-minute value is an SWPC estimate. Solar wind is measured at the Sun–Earth L1 point, about 30–60 minutes upstream of Earth. X-ray flux is GOES 0.1–0.8 nm.',
      };
    },

    setRowControlsListener(value) {
      listener = typeof value === 'function' ? value : null;
    },

    getStats() {
      const kp = snapshot?.kp?.latest?.kp;
      return {
        count: snapshot?.alerts?.length || 0,
        countLabel: Number.isFinite(kp) ? `Kp ${kp.toFixed(1)}` : undefined,
        lastUpdate: snapshot?.fetchedAt ?? null,
        loading,
        error,
        stale: Boolean(snapshot?.stale),
        status: snapshot?.unavailable
          ? 'unavailable'
          : error
            ? 'degraded'
            : 'nominal',
        source: 'NOAA SWPC',
      };
    },

    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      snapshot = null;
      listener = null;
    },
  };
  return layer;
}
