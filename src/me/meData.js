/**
 * ME — the client data hub. Owns browser geolocation tracking, talks to the
 * local /api/me endpoints (your phone apps' fixes, imports, IP estimate) and
 * turns everything into GeoJSON for the Overlay Library's local sources.
 * Location never leaves this machine except the opt-in IP lookup.
 */
import { parseLocationFile } from './importers.js';
import { toCsv, toGeojson, toGpx } from './exporters.js';
import {
  byDevice,
  deviceColor,
  places,
  segments,
  stays,
  thin,
} from './trackMath.js';

const DAY = 86_400_000;
const BROWSER_DEVICE = 'browser';
const TRACKING_KEY = 'gev.me.tracking';
export const ME_RANGES = Object.freeze({
  today: { label: 'Today', since: () => startOfDay(Date.now()) },
  '24h': { label: '24 h', since: () => Date.now() - DAY },
  '7d': { label: '7 days', since: () => Date.now() - 7 * DAY },
  '30d': { label: '30 days', since: () => Date.now() - 30 * DAY },
  year: { label: '1 year', since: () => Date.now() - 365 * DAY },
  all: { label: 'All', since: () => 0 },
});

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Accuracy circle as a GeoJSON polygon (pure). */
export function accuracyCircle(lat, lon, radiusM, steps = 48) {
  const ring = [];
  const dLat = (radiusM / 6_371_008.8) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

const pointFeature = (lon, lat, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

export function createMeData({
  fetchImpl,
  storage = safeStorage(),
  geolocation = globalThis.navigator?.geolocation,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const listeners = new Set();
  const state = {
    range: 'today',
    devices: [],
    fixes: [], // server fixes in range (all devices)
    live: [], // this browser's fixes since load (not yet echoed by the server)
    tracking: false,
    trackingError: null,
    lastBrowserFix: null,
    ip: null,
    loading: false,
    error: null,
    lastRefresh: 0,
  };
  let watchId = null;
  let pending = [];
  let flushTimer = 0;
  let pollTimer = 0;
  let retainCount = 0;
  let wakeLock = null;
  let destroyed = false;

  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn(state);
      } catch (error) {
        console.warn('[ME] listener error', error);
      }
    }
  };

  async function getJson(url, init) {
    const response = await doFetch(url, init);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }
  const postJson = (url, value) =>
    getJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });

  async function refresh() {
    if (destroyed) return;
    state.loading = true;
    try {
      const since = ME_RANGES[state.range]?.since() ?? 0;
      const [devices, track] = await Promise.all([
        getJson('/api/me/state'),
        getJson(`/api/me/track?since=${since}&limit=50000`),
      ]);
      state.devices = devices.devices || [];
      state.fixes = track.fixes || [];
      // Browser fixes the server now has are no longer "live only".
      const known = new Set(
        state.fixes.filter((f) => f.device === BROWSER_DEVICE).map((f) => f.t),
      );
      state.live = state.live.filter((f) => !known.has(f.t));
      state.error = null;
      state.lastRefresh = Date.now();
    } catch (error) {
      state.error = String(error?.message || error);
    } finally {
      state.loading = false;
      notify();
    }
  }

  function retain() {
    retainCount++;
    if (retainCount === 1) {
      refresh();
      pollTimer = setInterval(refresh, 15_000);
    }
    return () => {
      retainCount = Math.max(0, retainCount - 1);
      if (!retainCount) {
        clearInterval(pollTimer);
        pollTimer = 0;
      }
    };
  }

  // ── browser geolocation ─────────────────────────────────────────────────
  function onPosition(position) {
    const c = position.coords;
    const fix = {
      device: BROWSER_DEVICE,
      t: position.timestamp || Date.now(),
      lat: c.latitude,
      lon: c.longitude,
      ...(Number.isFinite(c.altitude) ? { alt: c.altitude } : {}),
      ...(Number.isFinite(c.accuracy) ? { acc: c.accuracy } : {}),
      ...(Number.isFinite(c.speed) ? { spd: c.speed } : {}),
      ...(Number.isFinite(c.heading) ? { hdg: c.heading } : {}),
      src: 'browser',
    };
    state.lastBrowserFix = fix;
    state.trackingError = null;
    state.live.push(fix);
    if (state.live.length > 20_000)
      state.live.splice(0, state.live.length - 20_000);
    pending.push(fix);
    notify();
  }
  function onPositionError(error) {
    state.trackingError =
      error?.code === 1
        ? 'Location permission denied — allow it for this site in the browser'
        : error?.code === 2
          ? 'Position unavailable (no GPS/Wi-Fi fix) — try IP locate'
          : error?.code === 3
            ? 'Timed out waiting for a fix'
            : String(error?.message || 'Location error');
    notify();
  }

  async function flush() {
    if (!pending.length) return;
    const batch = pending.splice(0, 500);
    try {
      await postJson('/api/me/browser', { fixes: batch });
    } catch {
      pending.unshift(...batch); // keep for the next attempt
      if (pending.length > 5000) pending.splice(0, pending.length - 5000);
    }
  }

  async function requestWakeLock() {
    try {
      if (
        globalThis.document?.visibilityState === 'visible' &&
        navigator.wakeLock &&
        !wakeLock
      )
        wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }
  const onVisibility = () => {
    if (state.tracking) requestWakeLock();
  };

  function startTracking() {
    if (!geolocation) {
      state.trackingError = 'This browser has no Geolocation API';
      notify();
      return;
    }
    if (watchId !== null) return;
    watchId = geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 60_000,
    });
    state.tracking = true;
    flushTimer = setInterval(flush, 5000);
    globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
    requestWakeLock();
    try {
      storage?.setItem(TRACKING_KEY, '1');
    } catch {
      /* preference only */
    }
    notify();
  }

  function stopTracking() {
    if (watchId !== null) geolocation?.clearWatch(watchId);
    watchId = null;
    clearInterval(flushTimer);
    flush();
    state.tracking = false;
    globalThis.document?.removeEventListener?.(
      'visibilitychange',
      onVisibility,
    );
    wakeLock?.release?.().catch?.(() => {});
    wakeLock = null;
    try {
      storage?.removeItem(TRACKING_KEY);
    } catch {
      /* preference only */
    }
    notify();
  }

  function locateOnce() {
    return new Promise((resolve) => {
      if (!geolocation) return resolve(null);
      geolocation.getCurrentPosition(
        (position) => {
          onPosition(position);
          flush();
          resolve(state.lastBrowserFix);
        },
        (error) => {
          onPositionError(error);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 30_000, maximumAge: 10_000 },
      );
    });
  }

  async function ipLocate() {
    try {
      state.ip = await getJson('/api/me/ip');
    } catch (error) {
      state.ip = { error: String(error?.message || error) };
    }
    notify();
    return state.ip;
  }

  // ── files ──────────────────────────────────────────────────────────────
  async function importFiles(fileList, onProgress = () => {}) {
    const results = [];
    for (const file of [...fileList]) {
      const isImage =
        /^image\//.test(file.type) || /\.(jpe?g)$/i.test(file.name);
      const content = isImage ? await file.arrayBuffer() : await file.text();
      const { format, fixes } = parseLocationFile(file.name, content);
      // Untimed points keep their order with synthetic, distinct times.
      const base = file.lastModified || Date.now();
      const timed = fixes.map((f, i) => ({
        ...f,
        t: f.t ?? base - (fixes.length - i) * 1000,
      }));
      const device = isImage
        ? 'photos'
        : `import · ${file.name.replace(/\.[^.]+$/, '').slice(0, 28)}`;
      let added = 0;
      for (let i = 0; i < timed.length; i += 20_000) {
        const result = await postJson('/api/me/import', {
          device,
          fixes: timed.slice(i, i + 20_000),
        });
        added += result.added || 0;
        onProgress({
          file: file.name,
          done: Math.min(timed.length, i + 20_000),
          total: timed.length,
        });
      }
      results.push({ file: file.name, format, parsed: fixes.length, added });
    }
    await refresh();
    return results;
  }

  async function exportFixes(format, range = state.range) {
    const since = ME_RANGES[range]?.since() ?? 0;
    const { fixes } = await getJson(`/api/me/track?since=${since}&limit=50000`);
    const stamp = new Date().toISOString().slice(0, 10);
    const [text, type, ext] =
      format === 'gpx'
        ? [toGpx(fixes), 'application/gpx+xml', 'gpx']
        : format === 'csv'
          ? [toCsv(fixes), 'text/csv', 'csv']
          : [toGeojson(fixes), 'application/geo+json', 'geojson'];
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `my-locations-${range}-${stamp}.${ext}`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return fixes.length;
  }

  async function forget(device = null) {
    const result = await postJson('/api/me/forget', device ? { device } : {});
    if (!device || device === BROWSER_DEVICE) state.live = [];
    await refresh();
    return result.removed;
  }

  const setup = () => getJson('/api/me/setup');

  // ── GeoJSON for the overlay sources ────────────────────────────────────
  function allFixes() {
    return [...state.fixes, ...state.live].sort((a, b) => a.t - b.t);
  }

  function latestByDevice() {
    const latest = new Map();
    for (const d of state.devices) if (d.last) latest.set(d.device, d.last);
    for (const f of state.live)
      if (!latest.has(f.device) || latest.get(f.device).t < f.t)
        latest.set(f.device, f);
    return latest;
  }

  function positionFeatures() {
    const out = [];
    for (const [device, f] of latestByDevice()) {
      if (device === 'photos' || device.startsWith('import')) continue;
      out.push(
        pointFeature(f.lon, f.lat, {
          name:
            device === BROWSER_DEVICE ? 'ME · this browser' : `ME · ${device}`,
          device,
          time: f.t,
          accuracy_m: f.acc,
          speed_kmh: Number.isFinite(f.spd) ? f.spd * 3.6 : undefined,
          heading: f.hdg,
          altitude_m: f.alt,
          battery: f.batt,
          source: f.src,
          color: deviceColor(device),
        }),
      );
    }
    if (state.ip && Number.isFinite(state.ip.lat))
      out.push(
        pointFeature(state.ip.lon, state.ip.lat, {
          name: `ME · IP estimate (${[state.ip.city, state.ip.country].filter(Boolean).join(', ')})`,
          device: 'ip',
          source: `IP via ${state.ip.source}`,
          isp: state.ip.isp,
          note: state.ip.note,
          color: '#9aa7b8',
        }),
      );
    return out;
  }

  function accuracyFeatures() {
    const out = [];
    for (const [device, f] of latestByDevice()) {
      if (
        !Number.isFinite(f.acc) ||
        f.acc <= 0 ||
        device === 'photos' ||
        device.startsWith('import')
      )
        continue;
      out.push({
        type: 'Feature',
        geometry: accuracyCircle(f.lat, f.lon, Math.min(f.acc, 50_000)),
        properties: {
          name: `${device} accuracy ±${Math.round(f.acc)} m`,
          color: deviceColor(device),
        },
      });
    }
    if (state.ip && Number.isFinite(state.ip.lat))
      out.push({
        type: 'Feature',
        geometry: accuracyCircle(state.ip.lat, state.ip.lon, 25_000),
        properties: {
          name: 'IP estimate (city-level, ~25 km)',
          color: '#9aa7b8',
        },
      });
    return out;
  }

  function trailFeatures() {
    const out = [];
    for (const [device, list] of byDevice(allFixes())) {
      if (device === 'photos') continue;
      for (const seg of segments(list)) {
        const pts = thin(seg, 4, 8000);
        out.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: pts.map((f) => [f.lon, f.lat]),
          },
          properties: {
            name: device,
            device,
            start: seg[0].t,
            end: seg[seg.length - 1].t,
            points: seg.length,
            color: deviceColor(device),
          },
        });
      }
    }
    return out;
  }

  function placeFeatures() {
    const all = [];
    for (const [device, list] of byDevice(allFixes()))
      if (device !== 'photos') all.push(...stays(list));
    return places(all)
      .slice(0, 300)
      .map((p, i) =>
        pointFeature(p.lon, p.lat, {
          name: `Place #${i + 1}`,
          hours: Math.round((p.dwellMs / 3_600_000) * 10) / 10,
          visits: p.visits,
          last: p.last,
        }),
      );
  }

  function photoFeatures() {
    return allFixes()
      .filter((f) => f.device === 'photos')
      .map((f) =>
        pointFeature(f.lon, f.lat, {
          name: 'Photo',
          time: f.t,
          altitude_m: f.alt,
        }),
      );
  }

  const SOURCES = {
    'me-position': positionFeatures,
    'me-accuracy': accuracyFeatures,
    'me-trail': trailFeatures,
    'me-places': placeFeatures,
    'me-photos': photoFeatures,
  };

  /** Overlay Library local sources: {load, subscribe} per source id. */
  function overlaySource(id) {
    return {
      load: async () => {
        if (!state.lastRefresh && !state.loading) await refresh();
        return {
          features: SOURCES[id](),
          fetchedAt: state.lastRefresh || Date.now(),
        };
      },
      subscribe(fn) {
        let last = 0;
        const listener = () => {
          // Coalesce bursts (every GPS fix notifies) to ~1 redraw per second.
          const now = Date.now();
          if (now - last < 1000) return;
          last = now;
          fn();
        };
        listeners.add(listener);
        const release = retain();
        return () => {
          listeners.delete(listener);
          release();
        };
      },
    };
  }

  // Resume tracking if it was on when the page was last open.
  try {
    if (storage?.getItem(TRACKING_KEY) === '1') queueMicrotask(startTracking);
  } catch {
    /* preference only */
  }

  return {
    state,
    sourceIds: Object.keys(SOURCES),
    overlaySource,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    retain,
    refresh,
    setRange(range) {
      if (!ME_RANGES[range]) return;
      state.range = range;
      refresh();
    },
    startTracking,
    stopTracking,
    locateOnce,
    ipLocate,
    importFiles,
    exportFixes,
    forget,
    setup,
    allFixes,
    latestByDevice,
    destroy() {
      destroyed = true;
      if (watchId !== null) geolocation?.clearWatch(watchId);
      clearInterval(flushTimer);
      clearInterval(pollTimer);
      flush();
      wakeLock?.release?.().catch?.(() => {});
      listeners.clear();
    },
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
