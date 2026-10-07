import { findNextSatellitePass } from '../../data/satellitePass.js';

/**
 * Upcoming passes of one object over an observer, using the app's existing
 * SGP4 pass finder (rise/set bisection, Sun-lit/dark-sky visibility).
 *
 * @param {object} satrec SGP4 record.
 * @param {{latDeg:number, lonDeg:number, fromMs?:number, count?:number, minElevDeg?:number, horizonHours?:number}} observer
 * @returns {Array<{riseMs:number, setMs:number, maxElevDeg:number, maxElevMs:number, riseAzDeg:number, visible:boolean}>}
 */
export function nextPasses(
  satrec,
  {
    latDeg,
    lonDeg,
    fromMs = Date.now(),
    count = 3,
    minElevDeg = 10,
    horizonHours = 24,
  },
) {
  const passes = [];
  const endMs = fromMs + horizonHours * 3_600_000;
  let cursor = fromMs;
  for (let i = 0; i < count && cursor < endMs; i++) {
    const pass = findNextSatellitePass({
      satrec,
      latDeg,
      lonDeg,
      fromMs: cursor,
      minElevDeg,
      horizonHours: Math.max(0.1, (endMs - cursor) / 3_600_000),
    });
    if (!pass || !(pass.setMs > cursor)) break;
    passes.push({
      riseMs: pass.riseMs,
      setMs: pass.setMs,
      maxElevDeg: pass.maxElevDeg,
      maxElevMs: pass.maxElevMs,
      riseAzDeg: pass.riseAzDeg,
      visible: pass.visible === true,
    });
    cursor = pass.setMs + 60_000;
  }
  return passes;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Eight-point compass label for an azimuth. */
export function compassPoint(azDeg) {
  if (!Number.isFinite(azDeg)) return '—';
  return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];
}

/** `HH:MM UTC` for an epoch. */
export function utcClock(ms) {
  if (!Number.isFinite(ms)) return '—';
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

/** One-line description of a pass. */
export function describePass(pass, nowMs = Date.now()) {
  const inMin = Math.round((pass.riseMs - nowMs) / 60_000);
  const when =
    pass.riseMs <= nowMs
      ? 'overhead now'
      : inMin < 90
        ? `in ${inMin} min`
        : utcClock(pass.riseMs);
  const minutes = Math.max(1, Math.round((pass.setMs - pass.riseMs) / 60_000));
  return `${when} · rise ${compassPoint(pass.riseAzDeg)} · max ${Math.round(pass.maxElevDeg)}° · ${minutes} min${pass.visible ? ' · naked-eye visible' : ''}`;
}

/**
 * Observer point for "passes over the camera": the camera's nadir.
 * @param {{camera?: {positionCartographic?: {latitude:number, longitude:number}}}} viewer
 * @returns {{latDeg:number, lonDeg:number}|null}
 */
export function cameraObserver(viewer) {
  const carto = viewer?.camera?.positionCartographic;
  if (!carto || !Number.isFinite(carto.latitude)) return null;
  return {
    latDeg: (carto.latitude * 180) / Math.PI,
    lonDeg: (carto.longitude * 180) / Math.PI,
  };
}

/**
 * Cache key for an observer, quantized so camera drift does not trigger a
 * fresh 24-hour search every frame.
 */
export function observerKey(observer, cellDeg = 0.5) {
  if (!observer) return 'none';
  const q = (v) => Math.round(v / cellDeg) * cellDeg;
  return `${q(observer.latDeg)},${q(observer.lonDeg)}`;
}
