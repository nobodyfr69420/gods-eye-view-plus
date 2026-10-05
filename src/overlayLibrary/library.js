import * as Cesium from 'cesium';
import { OVERLAY_DEFINITIONS, OVERLAY_BY_ID } from './definitions.js';
import { createRenderSet } from './renderer.js';
import { createFeedClient } from './feedClient.js';
import {
  createOsmTileSource,
  tilesAround,
  tileWidthM,
  zoomForAltitude,
} from './osmTiles.js';
import { canvasImageryProvider, createImageryOverlay } from './imagery.js';
import {
  hideOsmCredit,
  registerDynamicCredit,
  showOsmCredit,
} from '../data/dataCredits.js';
import {
  antipodeFeature,
  compassLineFeatures,
  goldenHourShade,
  graticuleFeatures,
  horizonFeature,
  keyParallelFeatures,
  maidenheadFeatures,
  meridianFeatures,
  nightShade,
  rangeRingFeatures,
  rasterizeSolar,
  subsolarFeatures,
  sublunarFeatures,
  timeMeridianFeatures,
  twilightFeature,
  utmFeatures,
} from './computedGeometry.js';

/**
 * The Overlay Library runtime: owns every enabled overlay's controller,
 * reacts to the camera, persists the user's choices and exposes live
 * statistics. Independent from the data-layer manager, so the 280+ overlays
 * never enter share links or the built-in layer registry.
 */

const STORAGE_KEY = 'gev.overlayLibrary.v1';
const VIEW_DEBOUNCE_MS = 450;
const CULL_INTERVAL_MS = 180;

function safeStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = '__gev_ovl_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Read the camera into a plain view description (degrees + radians rect). */
export function describeView(viewer) {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const carto = camera.positionCartographic;
  const altitude = Math.max(1, carto?.height ?? 1e7);
  let center = null;
  const canvas = scene.canvas;
  try {
    const ray = camera.getPickRay(
      new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
    );
    const hit =
      ray &&
      scene.globe.ellipsoid &&
      Cesium.IntersectionTests.rayEllipsoid(ray, Cesium.Ellipsoid.WGS84);
    if (hit) {
      const p = Cesium.Ray.getPoint(ray, hit.start);
      const c = Cesium.Cartographic.fromCartesian(p);
      if (c)
        center = {
          lat: Cesium.Math.toDegrees(c.latitude),
          lon: Cesium.Math.toDegrees(c.longitude),
        };
    }
  } catch {
    center = null;
  }
  if (!center && carto)
    center = {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  let rect = null;
  try {
    rect = camera.computeViewRectangle(Cesium.Ellipsoid.WGS84) || null;
  } catch {
    rect = null;
  }
  const nadir = carto
    ? {
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
      }
    : center;
  const bbox = rect
    ? {
        west: Cesium.Math.toDegrees(rect.west),
        south: Cesium.Math.toDegrees(rect.south),
        east: Cesium.Math.toDegrees(rect.east),
        north: Cesium.Math.toDegrees(rect.north),
      }
    : null;
  return { altitude, center, nadir, rect, bbox, at: Date.now() };
}

/** Clamp a view bbox to at most `span` degrees around the center (no dateline wrap). */
export function clampBbox(bbox, center, span) {
  const half = span / 2;
  const c = center || { lat: 0, lon: 0 };
  let west = Math.max(c.lon - half, bbox ? bbox.west : -180);
  let east = Math.min(c.lon + half, bbox ? bbox.east : 180);
  if (!bbox || bbox.west > bbox.east) {
    west = c.lon - half;
    east = c.lon + half;
  }
  const south = Math.max(-89, Math.max(c.lat - half, bbox ? bbox.south : -90));
  const north = Math.min(89, Math.min(c.lat + half, bbox ? bbox.north : 90));
  return {
    west: Math.max(-180, west),
    east: Math.min(180, east),
    south,
    north: north > south ? north : south + 0.5,
  };
}

export function createOverlayLibrary({
  viewer,
  mapStackController = null,
  overlayHost = null,
  definitions = OVERLAY_DEFINITIONS,
  storage = safeStorage(),
  fetchImpl,
} = {}) {
  if (!viewer?.scene) throw new TypeError('A Cesium viewer is required');
  const scene = viewer.scene;
  const feedClient = createFeedClient(fetchImpl ? { fetchImpl } : {});
  const osmSource = createOsmTileSource(fetchImpl ? { fetchImpl } : {});
  const byId =
    definitions === OVERLAY_DEFINITIONS
      ? OVERLAY_BY_ID
      : new Map(definitions.map((d) => [d.id, d]));
  const active = new Map(); // id → controller
  const listeners = new Set();
  const prefs = { enabled: [], alpha: {}, favorites: [] };
  let view = describeView(viewer);
  let viewTimer = null;
  let destroyed = false;
  let lastCull = 0;
  let cullPending = true;
  const openedAt = Date.now();
  const events = []; // activity log for the stats tab

  // ── persistence ────────────────────────────────────────────────────────
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.enabled))
        prefs.enabled = saved.enabled.filter((id) => byId.has(id));
      if (saved.alpha && typeof saved.alpha === 'object')
        for (const [k, v] of Object.entries(saved.alpha))
          if (byId.has(k) && Number.isFinite(Number(v)))
            prefs.alpha[k] = Math.max(0, Math.min(1, Number(v)));
      if (Array.isArray(saved.favorites))
        prefs.favorites = saved.favorites.filter((id) => byId.has(id));
    }
  } catch {
    /* ignore corrupt preferences */
  }
  function persist() {
    try {
      storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: [...active.keys()],
          alpha: prefs.alpha,
          favorites: prefs.favorites,
        }),
      );
    } catch {
      /* storage full or blocked */
    }
  }

  function log(type, id, message) {
    events.push({ at: Date.now(), type, id, message });
    if (events.length > 80) events.shift();
  }

  let notifyQueued = false;
  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch (error) {
          console.warn('[OverlayLibrary] listener error', error);
        }
      }
    });
  }

  // ── controllers ────────────────────────────────────────────────────────
  function baseController(def) {
    return {
      def,
      status: 'loading',
      message: '',
      count: 0,
      bytes: 0,
      loadMs: null,
      lastUpdate: null,
      errors: 0,
      alpha: prefs.alpha[def.id] ?? 1,
      set(status, patch = {}) {
        this.status = status;
        Object.assign(this, patch);
        notify();
      },
    };
  }

  function vectorController(def, loader) {
    const c = baseController(def);
    const renderSet = createRenderSet({ viewer, def, overlayHost });
    renderSet.setAlpha(c.alpha);
    let timer = null;
    let abort = null;
    let seq = 0;
    c.renderSet = renderSet;
    c.load = async (reason = 'initial') => {
      const my = ++seq;
      abort?.abort();
      abort = new AbortController();
      const started = performance.now();
      if (c.status !== 'ready' || reason === 'initial')
        c.set('loading', { message: '' });
      try {
        const result = await loader({ signal: abort.signal, reason });
        if (my !== seq || destroyed || !active.has(def.id)) return;
        if (result?.status === 'zoom') {
          renderSet.setFeatures([]);
          renderSet.setVisible(false);
          c.set('zoom', {
            count: 0,
            message: result.message || 'Zoom in to load',
          });
          return;
        }
        renderSet.setVisible(true);
        const features = result.features || [];
        if (def.kind === 'osm' && features.length)
          showOsmCredit(viewer, c, { openMapTiles: true });
        renderSet.setFeatures(features);
        renderSet.updateLabels(view.rect);
        cullPending = true;
        c.set(result.stale ? 'stale' : 'ready', {
          count: renderSet.counts.total,
          featureCount: features.length,
          bytes: result.bytes ?? c.bytes,
          loadMs: Math.round(performance.now() - started),
          lastUpdate: result.fetchedAt || Date.now(),
          message: result.stale
            ? 'Showing cached data (source unavailable)'
            : result.message || '',
        });
      } catch (error) {
        if (error?.name === 'AbortError' || my !== seq) return;
        c.errors++;
        log('error', def.id, String(error?.message || error));
        c.set('error', {
          message: String(error?.message || 'Failed to load').slice(0, 140),
        });
      }
    };
    c.start = () => {
      c.load('initial');
      if (def.refreshMs)
        timer = setInterval(() => c.load('refresh'), def.refreshMs);
    };
    c.onView = () => renderSet.updateLabels(view.rect);
    c.setAlpha = (a) => {
      c.alpha = a;
      renderSet.setAlpha(a);
    };
    c.destroy = () => {
      clearInterval(timer);
      abort?.abort();
      renderSet.destroy();
      if (def.kind === 'osm') hideOsmCredit(viewer, c);
    };
    return c;
  }

  function feedController(def) {
    const maxAge = Math.max(
      30_000,
      Math.min(def.refreshMs || 600_000, 600_000),
    );
    const c = vectorController(def, async ({ signal, reason }) => {
      const query = {};
      if (def.query) {
        if (def.maxAltitudeM && view.altitude > def.maxAltitudeM)
          return {
            status: 'zoom',
            message: `Zoom in below ${formatAlt(def.maxAltitudeM)}`,
          };
        if (def.query === 'bbox')
          query.bbox = clampBbox(view.bbox, view.center, def.maxSpanDeg || 10);
        if (def.query === 'point') query.point = view.center;
      }
      const value = await feedClient.get(def.feed, query, {
        signal,
        maxAgeMs: reason === 'refresh' ? 15_000 : maxAge,
      });
      const prop = def.style?.filterProp;
      const features = prop
        ? value.features.filter(
            (f) =>
              f.properties?.[prop] !== null &&
              f.properties?.[prop] !== undefined,
          )
        : value.features;
      return { ...value, features };
    });
    const baseOnView = c.onView;
    let queryTimer = null;
    c.onView = () => {
      baseOnView();
      if (def.query) {
        clearTimeout(queryTimer);
        queryTimer = setTimeout(() => c.load('view'), 250);
      }
    };
    const baseDestroy = c.destroy;
    c.destroy = () => {
      clearTimeout(queryTimer);
      baseDestroy();
    };
    return c;
  }

  function osmController(def) {
    const filter = def.osm;
    const c = vectorController(def, async ({ signal }) => {
      if (view.altitude > def.maxAltitudeM)
        return {
          status: 'zoom',
          message: `Zoom in below ${formatAlt(def.maxAltitudeM)}`,
        };
      const center = view.center;
      if (!center)
        return { status: 'zoom', message: 'Point the camera at the ground' };
      const z = Math.max(
        filter.minZoom ?? 14,
        Math.min(14, zoomForAltitude(view.altitude)),
      );
      const width = tileWidthM(z, center.lat);
      const viewRadius = Math.max(
        width,
        Math.min(view.altitude * 1.6, 400_000),
      );
      const maxTiles = z >= 14 ? 30 : 36;
      const radius = Math.min(viewRadius, width * 3.2);
      const tiles = tilesAround(center.lon, center.lat, z, radius, maxTiles);
      const settled = [];
      const queue = tiles.slice();
      const workers = Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const t = queue.shift();
          try {
            settled.push(await osmSource.getTile(t, signal));
          } catch (error) {
            if (error?.name === 'AbortError') throw error;
          }
        }
      });
      await Promise.all(workers);
      const geometry = def.geometry === 'point' ? 'point' : 'shape';
      const features = osmSource.extract(
        settled,
        filter,
        geometry === 'point' ? 'point' : 'any',
      );
      const bytes = settled.reduce((s, e) => s + (e?.bytes || 0), 0);
      return {
        features,
        bytes,
        message: `${settled.length}/${tiles.length} tiles @ z${z}`,
        fetchedAt: Date.now(),
      };
    });
    const baseOnView = c.onView;
    let viewLoadTimer = null;
    c.onView = () => {
      baseOnView();
      clearTimeout(viewLoadTimer);
      viewLoadTimer = setTimeout(() => c.load('view'), 120);
    };
    const baseDestroy = c.destroy;
    c.destroy = () => {
      clearTimeout(viewLoadTimer);
      baseDestroy();
    };
    return c;
  }

  const COMPUTED = {
    graticule: () => graticuleFeatures(10),
    'graticule-local': () => {
      const b = view.bbox;
      if (!b || view.altitude > 3_000_000) return null;
      return graticuleFeatures(1, {
        west: Math.max(-180, Math.floor(b.west) - 1),
        east: Math.min(180, Math.ceil(b.east) + 1),
        south: Math.max(-89, Math.floor(b.south) - 1),
        north: Math.min(89, Math.ceil(b.north) + 1),
      });
    },
    parallels: () => keyParallelFeatures(new Date()),
    meridians: () => meridianFeatures(),
    utm: () => utmFeatures(),
    maidenhead: () => maidenheadFeatures(),
    'time-meridians': () => timeMeridianFeatures(),
    'range-rings': () =>
      view.center ? rangeRingFeatures(view.center.lat, view.center.lon) : [],
    horizon: () =>
      view.nadir
        ? [horizonFeature(view.nadir.lat, view.nadir.lon, view.altitude)]
        : [],
    antipode: () =>
      view.center ? [antipodeFeature(view.center.lat, view.center.lon)] : [],
    'compass-lines': () =>
      view.center ? compassLineFeatures(view.center.lat, view.center.lon) : [],
    twilight: (def) => [
      twilightFeature(new Date(), def.params?.depression ?? 0),
    ],
    subsolar: () => subsolarFeatures(new Date()),
    sublunar: () => sublunarFeatures(new Date()),
  };
  const RASTER = { night: nightShade, 'golden-hour': goldenHourShade };

  function computedController(def) {
    if (RASTER[def.computed])
      return rasterController(def, RASTER[def.computed]);
    const c = vectorController(def, async () => {
      const features = COMPUTED[def.computed]?.(def);
      if (features === null)
        return { status: 'zoom', message: 'Zoom in below 3,000 km' };
      return { features: features || [], fetchedAt: Date.now() };
    });
    if (def.dynamic) {
      const baseOnView = c.onView;
      c.onView = () => {
        baseOnView();
        c.load('view');
      };
    }
    return c;
  }

  function rasterController(def, shade) {
    const c = baseController(def);
    let overlay = null;
    let timer = null;
    let generation = 0;
    const width = 720;
    const height = 360;
    async function render() {
      const my = ++generation;
      const started = performance.now();
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const pixels = rasterizeSolar(width, height, new Date(), shade);
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        const provider = await canvasImageryProvider(canvas);
        if (my !== generation || destroyed || !active.has(def.id)) return;
        if (!overlay)
          overlay = createImageryOverlay({
            viewer,
            mapStackController,
            def: { ...def, imagery: { alpha: 1 } },
            provider,
            alpha: c.alpha,
            onStatus: notify,
          });
        else overlay.replaceProvider(provider);
        c.set('ready', {
          count: null,
          loadMs: Math.round(performance.now() - started),
          lastUpdate: Date.now(),
          message: '',
        });
      } catch (error) {
        c.set('error', {
          message: String(error?.message || error).slice(0, 140),
        });
      }
    }
    c.start = () => {
      render();
      timer = setInterval(render, def.refreshMs || 60_000);
    };
    c.onView = () => {};
    c.setAlpha = (a) => {
      c.alpha = a;
      overlay?.setAlpha(a);
    };
    c.destroy = () => {
      clearInterval(timer);
      overlay?.destroy();
    };
    c.imageryStatus = () => overlay?.status() || null;
    return c;
  }

  function imageryController(def) {
    const c = baseController(def);
    let overlay = null;
    c.start = () => {
      try {
        overlay = createImageryOverlay({
          viewer,
          mapStackController,
          def,
          alpha: c.alpha,
          onStatus: () => sync(),
        });
        sync();
      } catch (error) {
        c.set('error', {
          message: String(error?.message || error).slice(0, 140),
        });
      }
    };
    function sync() {
      const s = overlay?.status();
      if (!s) return;
      if (s.hostMessage)
        c.set('hidden', { message: s.hostMessage, count: null });
      else if (s.tileErrors > 24)
        c.set('ready', {
          message: `${s.tileErrors} tiles failed to load`,
          count: null,
          lastUpdate: c.lastUpdate || Date.now(),
        });
      else
        c.set('ready', {
          message: '',
          count: null,
          lastUpdate: c.lastUpdate || Date.now(),
        });
    }
    c.onView = () => {};
    c.setAlpha = (a) => {
      c.alpha = a;
      overlay?.setAlpha(a);
    };
    c.destroy = () => overlay?.destroy();
    c.imageryStatus = () => overlay?.status() || null;
    return c;
  }

  function createController(def) {
    switch (def.kind) {
      case 'imagery':
        return imageryController(def);
      case 'feed':
        return feedController(def);
      case 'osm':
        return osmController(def);
      case 'computed':
        return computedController(def);
      default:
        throw new Error(`Unknown overlay kind: ${def.kind}`);
    }
  }

  // ── camera wiring ──────────────────────────────────────────────────────
  function onViewSettled() {
    if (destroyed) return;
    view = describeView(viewer);
    for (const c of active.values()) {
      try {
        c.onView?.();
      } catch (error) {
        console.warn('[OverlayLibrary] view update failed', c.def.id, error);
      }
    }
    cullPending = true;
    notify();
  }
  const removeMoveEnd = viewer.camera.moveEnd.addEventListener(() => {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(onViewSettled, VIEW_DEBOUNCE_MS);
  });
  viewer.camera.percentageChanged = Math.min(
    viewer.camera.percentageChanged ?? 0.5,
    0.2,
  );
  const removeChanged = viewer.camera.changed.addEventListener(() => {
    cullPending = true;
  });
  const removePostRender = scene.postRender.addEventListener(() => {
    if (!cullPending || !active.size) return;
    const now = performance.now();
    if (now - lastCull < CULL_INTERVAL_MS) return;
    lastCull = now;
    cullPending = false;
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      viewer.camera.positionWC,
    );
    for (const c of active.values()) c.renderSet?.cull(occluder);
  });

  // ── render-error safety net ───────────────────────────────────────────
  // A malformed upstream shape must never take the whole globe down. If
  // Cesium reports a render error while overlay geometry is fresh, switch the
  // suspect overlays off, then restart the render loop (at most 3 times).
  const notices = [];
  let recoveries = 0;
  const removeRenderError = scene.renderError?.addEventListener?.(
    (_scene, error) => {
      if (destroyed || recoveries >= 3) return;
      const now = Date.now();
      const vector = [...active.values()].filter(
        (c) => c.renderSet && c.renderSet.counts.total > 0,
      );
      let suspects = vector.filter(
        (c) => now - (c.renderSet.builtAt || 0) < 120_000,
      );
      if (!suspects.length)
        suspects = vector.filter((c) => {
          const k = c.renderSet.counts;
          return k.lines + k.polygons + k.extrusions > 0;
        });
      if (!suspects.length) return;
      recoveries++;
      const message = String(error?.message || error || 'render error').slice(
        0,
        160,
      );
      for (const c of suspects) {
        notices.push({ at: now, id: c.def.id, name: c.def.name, message });
        log('crash', c.def.id, message);
        disable(c.def.id);
      }
      console.warn(
        '[OverlayLibrary] rendering error — turned off:',
        suspects.map((c) => c.def.id).join(', '),
        error,
      );
      setTimeout(() => {
        if (destroyed) return;
        for (const panel of document.querySelectorAll(
          '.cesium-widget-errorPanel',
        ))
          panel.remove();
        viewer.useDefaultRenderLoop = true;
        scene.requestRender?.();
        notify();
      }, 0);
    },
  );

  // ── picking ────────────────────────────────────────────────────────────
  const pickListeners = new Set();
  const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  clickHandler.setInputAction((click) => {
    if (!active.size) return;
    let picked;
    try {
      picked = scene.pick(click.position);
    } catch {
      return;
    }
    const id = picked?.id;
    if (!id || typeof id !== 'object' || !id.gevOverlay) return;
    const c = active.get(id.gevOverlay);
    const feature = c?.renderSet?.getFeature(id.index);
    if (!feature) return;
    for (const fn of pickListeners)
      fn({ def: c.def, feature, position: click.position });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ── public API ─────────────────────────────────────────────────────────
  function enable(id) {
    if (destroyed || active.has(id)) return;
    const def = byId.get(id);
    if (!def) return;
    const c = createController(def);
    active.set(id, c);
    // Feed overlays land their source in the app's "Data attribution" popover
    // (imagery providers carry their own Cesium credit).
    if (def.kind === 'feed') {
      try {
        registerDynamicCredit(viewer, {
          key: `overlay-${def.id}`,
          html: `Overlay · ${escapeHtml(def.name)}: ${escapeHtml(def.source)}`,
        });
      } catch {
        /* credits are best effort */
      }
    }
    log('enable', id);
    try {
      c.start();
    } catch (error) {
      c.set('error', {
        message: String(error?.message || error).slice(0, 140),
      });
    }
    persist();
    notify();
  }

  function disable(id) {
    const c = active.get(id);
    if (!c) return;
    active.delete(id);
    try {
      c.destroy();
    } catch (error) {
      console.warn('[OverlayLibrary] destroy failed', id, error);
    }
    log('disable', id);
    persist();
    notify();
  }

  function setAlpha(id, value) {
    const a = Math.max(0, Math.min(1, Number(value)));
    prefs.alpha[id] = a;
    active.get(id)?.setAlpha(a);
    persist();
    notify();
  }

  function reload(id) {
    const c = active.get(id);
    if (!c) return;
    if (c.load) c.load('initial');
    else {
      disable(id);
      enable(id);
    }
  }

  function toggleFavorite(id) {
    const i = prefs.favorites.indexOf(id);
    if (i >= 0) prefs.favorites.splice(i, 1);
    else if (byId.has(id)) prefs.favorites.push(id);
    persist();
    notify();
  }

  function getState(id) {
    const c = active.get(id);
    if (!c)
      return { enabled: false, status: 'off', alpha: prefs.alpha[id] ?? 1 };
    const img = c.imageryStatus?.();
    return {
      enabled: true,
      status: c.status,
      message: c.message,
      count: c.count,
      featureCount: c.featureCount ?? c.count,
      bytes: c.bytes,
      loadMs: c.loadMs,
      lastUpdate: c.lastUpdate,
      errors: c.errors,
      alpha: c.alpha,
      tileErrors: img?.tileErrors ?? 0,
      breakdown: c.renderSet?.counts || null,
    };
  }

  function getStats() {
    const overlays = [];
    let features = 0;
    for (const [id, c] of active) {
      const s = getState(id);
      overlays.push({ id, def: c.def, ...s });
      features += Number(s.count) || 0;
    }
    return {
      total: definitions.length,
      enabled: active.size,
      features,
      overlays,
      feeds: { ...feedClient.stats },
      feedHistory: feedClient.history.slice(),
      tiles: { ...osmSource.stats, cached: osmSource.cachedTiles },
      view: { ...view },
      events: events.slice(),
      uptimeMs: Date.now() - openedAt,
    };
  }

  /** Feature list of an active overlay (stats breakdowns). */
  function getFeatures(id) {
    return active.get(id)?.renderSet?.features || [];
  }

  function clearAll() {
    for (const id of [...active.keys()]) disable(id);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(viewTimer);
    for (const c of active.values()) {
      try {
        c.destroy();
      } catch {
        /* keep tearing down */
      }
    }
    active.clear();
    removeMoveEnd();
    removeChanged();
    removePostRender();
    removeRenderError?.();
    clickHandler.destroy();
    listeners.clear();
    pickListeners.clear();
  }

  // Restore the previous session's overlays once the first frame settles.
  const restore = prefs.enabled.slice();
  if (restore.length)
    setTimeout(() => restore.forEach((id) => enable(id)), 1200);

  return {
    definitions,
    enable,
    disable,
    toggle: (id) => (active.has(id) ? disable(id) : enable(id)),
    isEnabled: (id) => active.has(id),
    setAlpha,
    reload,
    clearAll,
    toggleFavorite,
    isFavorite: (id) => prefs.favorites.includes(id),
    getState,
    getStats,
    getFeatures,
    getView: () => view,
    getNotices: () => notices.slice(-5),
    feedClient,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onPick(fn) {
      pickListeners.add(fn);
      return () => pickListeners.delete(fn);
    },
    get activeIds() {
      return [...active.keys()];
    },
    destroy,
  };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatAlt(m) {
  return m >= 1000
    ? `${Math.round(m / 1000).toLocaleString('en-US')} km`
    : `${m} m`;
}
