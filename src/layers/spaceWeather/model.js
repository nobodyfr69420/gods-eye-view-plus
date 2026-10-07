import { kpToGScale, xrayToRScale } from './records.js';

/** Alert windows offered as chips. */
export const ALERT_WINDOWS = Object.freeze({ '24h': 24, '72h': 72, '7d': 168 });

/** Kp colour bands used by the legend and the summary swatch. */
export const KP_BANDS = Object.freeze([
  Object.freeze({ label: 'Kp 0–3 quiet', color: '#5fe08f', max: 4 }),
  Object.freeze({ label: 'Kp 4 active', color: '#c6f36b', max: 5 }),
  Object.freeze({ label: 'Kp 5–6 G1–G2', color: '#ffd166', max: 7 }),
  Object.freeze({ label: 'Kp 7–9 G3–G5', color: '#ff6f91', max: 10 }),
]);

const utc = (ms) =>
  Number.isFinite(ms)
    ? `${new Date(ms).toISOString().slice(5, 16).replace('T', ' ')} UTC`
    : '—';
const ago = (ms, nowMs) => {
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.max(0, Math.round((nowMs - ms) / 60_000));
  return minutes < 90
    ? `${minutes} min ago`
    : `${Math.round(minutes / 60)} h ago`;
};
const fixed = (value, digits, unit) =>
  Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : '—';

/** Kp band for a value. */
export function kpBand(kp) {
  return KP_BANDS.find((band) => kp < band.max) || KP_BANDS.at(-1);
}

/** `G2 (moderate)` style label for a scale entry. */
export function scaleLabel(letter, entry) {
  if (!entry || !Number.isFinite(entry.scale)) return `${letter}—`;
  return `${letter}${entry.scale}${entry.text && entry.text !== 'none' ? ` (${entry.text})` : ''}`;
}

/**
 * Alerts inside a window, newest first.
 * @param {Array<{issuedAt:number}>} alerts
 * @param {string} window Key of ALERT_WINDOWS.
 */
export function alertsInWindow(alerts, window, nowMs = Date.now()) {
  const hours = ALERT_WINDOWS[window] ?? 24;
  return (alerts || []).filter(
    (alert) => nowMs - alert.issuedAt <= hours * 3_600_000,
  );
}

/**
 * Text lines summarizing a validated SWPC snapshot.
 * @param {object} snapshot Result of validateSpaceWeatherSnapshot.
 * @param {number} [nowMs]
 * @returns {string[]}
 */
export function spaceWeatherSummaryLines(snapshot, nowMs = Date.now()) {
  if (!snapshot || snapshot.unavailable)
    return [snapshot?.reason || 'NOAA SWPC data unavailable'];
  const lines = [];
  const { kp, solarWind, xray, scales } = snapshot;
  if (kp.latest) {
    const g = kpToGScale(kp.latest.kp);
    lines.push(
      `Kp ${kp.latest.kp.toFixed(2)} (3-h, ${utc(kp.latest.at)})${g ? ` · G${g} storm level` : ''}${Number.isFinite(kp.max24h) ? ` · 24 h max ${kp.max24h.toFixed(2)}` : ''}`,
    );
  } else lines.push('Kp unavailable');
  if (kp.estimate)
    lines.push(
      `Estimated Kp now ${kp.estimate.kp.toFixed(2)} (1-min estimate, ${ago(kp.estimate.at, nowMs)})`,
    );
  const plasma = solarWind.plasma;
  const mag = solarWind.mag;
  if (plasma || mag) {
    lines.push(
      `Solar wind ${fixed(plasma?.speed, 0, 'km/s')} · density ${fixed(plasma?.density, 1, 'p/cm³')} · Bz ${fixed(mag?.bz, 1, 'nT')} · Bt ${fixed(mag?.bt, 1, 'nT')} (L1, ${ago(Math.max(plasma?.at ?? 0, mag?.at ?? 0), nowMs)})`,
    );
    if (Number.isFinite(mag?.bz) && mag.bz <= -10)
      lines.push(
        'Bz strongly southward: favourable for geomagnetic activity if sustained',
      );
  } else lines.push('Solar wind unavailable');
  if (xray.latest) {
    const r = xrayToRScale(xray.latest.flux);
    lines.push(
      `GOES X-ray ${xray.latest.flareClass} (${xray.latest.flux.toExponential(1)} W/m², ${ago(xray.latest.at, nowMs)})${r ? ` · R${r} radio blackout level` : ''}${xray.peak6h ? ` · 6 h peak ${xray.peak6h.flareClass} at ${utc(xray.peak6h.at)}` : ''}`,
    );
  } else lines.push('GOES X-ray flux unavailable');
  if (scales.current)
    lines.push(
      `NOAA scales now: ${scaleLabel('R', scales.current.R)} · ${scaleLabel('S', scales.current.S)} · ${scaleLabel('G', scales.current.G)}${scales.past24h ? ` · 24 h max ${scaleLabel('R', scales.past24h.R)} ${scaleLabel('S', scales.past24h.S)} ${scaleLabel('G', scales.past24h.G)}` : ''}`,
    );
  const down = Object.entries(snapshot.feeds || {})
    .filter(([, state]) => state !== 'ok')
    .map(([key]) => key);
  lines.push(
    `NOAA SWPC · fetched ${utc(snapshot.fetchedAt)}${snapshot.stale ? ' · some products STALE' : ''}${down.length ? ` · unavailable: ${down.join(', ')}` : ''}`,
  );
  return lines;
}
