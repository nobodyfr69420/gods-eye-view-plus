import * as Cesium from 'cesium';
import {
  AURORA_BANDS,
  AURORA_THRESHOLDS,
  AURORA_HEIGHT_M,
  auroraRuns,
  auroraHemisphereStats,
} from './model.js';
import { ovationProbabilityAt } from '../spaceWeather/records.js';
import { cameraObserver, utcClock } from '../satelliteGroups/passes.js';

export const AURORA_LAYER_ID = 'aurora-oval';
const FRESH_FORECAST_MS = 2 * 3_600_000;

/**
 * Aurora oval: NOAA SWPC OVATION Prime short-term forecast of the probability
 * of visible aurora, drawn as translucent 1° cells at the base of the auroral
 * emission layer (~110 km).
 * @param {{source: {getAurora: Function}, requestRender?: Function, cesium?: object, now?: () => number}} options
 */
export function createAuroraLayer({
  source,
  requestRender = () => {},
  cesium = Cesium,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getAurora !== 'function')
    throw new TypeError('Aurora requires an OVATION source');
  let viewer = null;
  let primitive = null;
  let snapshot = null;
  let threshold = AURORA_THRESHOLDS[0];
  let enabled = false;
  let destroyed = false;
  let loading = false;
  let error = null;
  let request = null;
  let listener = null;
  let cellCount = 0;
  let buildToken = 0;

  const notify = () => {
    try {
      listener?.();
    } catch {
      /* panel listener failures stay in the panel */
    }
  };

  function removePrimitive() {
    if (primitive && viewer && !primitive.isDestroyed?.())
      viewer.scene.primitives.remove(primitive);
    primitive = null;
  }

  function build() {
    const token = ++buildToken;
    removePrimitive();
    cellCount = 0;
    if (!viewer || !snapshot?.grid || !enabled) return;
    const runs = auroraRuns(snapshot.grid, threshold);
    if (!runs.length) {
      requestRender('aurora-oval');
      return;
    }
    const colors = AURORA_BANDS.map((band) =>
      cesium.ColorGeometryInstanceAttribute.fromColor(
        cesium.Color.fromCssColorString(band.color).withAlpha(
          snapshot.stale ? band.alpha * 0.6 : band.alpha,
        ),
      ),
    );
    const instances = runs.map(
      (run) =>
        new cesium.GeometryInstance({
          geometry: new cesium.RectangleGeometry({
            rectangle: cesium.Rectangle.fromDegrees(
              run.west,
              run.south,
              run.east,
              run.north,
            ),
            height: AURORA_HEIGHT_M,
            vertexFormat: cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          }),
          attributes: { color: colors[run.band] },
        }),
    );
    cellCount = runs.length;
    if (token !== buildToken) return;
    primitive = viewer.scene.primitives.add(
      new cesium.Primitive({
        geometryInstances: instances,
        appearance: new cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
        asynchronous: true,
        releaseGeometryInstances: true,
      }),
    );
    primitive.show = enabled;
    requestRender('aurora-oval');
  }

  const layer = {
    id: AURORA_LAYER_ID,
    name: 'Aurora Oval',
    icon: '〰',
    source: 'NOAA SWPC OVATION',
    updateInterval: 5 * 60_000,

    init(nextViewer) {
      viewer = nextViewer;
    },

    enable() {
      if (destroyed || enabled) return;
      enabled = true;
      if (primitive) primitive.show = true;
      else if (snapshot) build();
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      buildToken++;
      removePrimitive();
      notify();
      requestRender('aurora-oval');
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
        const next = await source.getAurora({ signal: controller.signal });
        if (!enabled || controller.signal.aborted || request !== controller)
          return false;
        if (next.unavailable) {
          error = next.reason;
          // An old oval must not keep presenting as the current forecast.
          if (
            !snapshot ||
            now() - (snapshot.forecastAt ?? snapshot.fetchedAt ?? 0) >
              FRESH_FORECAST_MS
          ) {
            snapshot = null;
            buildToken++;
            removePrimitive();
          }
          return true;
        }
        snapshot = next;
        error = null;
        build();
        return true;
      } catch (cause) {
        if (controller.signal.aborted || request !== controller) return false;
        error = cause?.message || 'OVATION aurora forecast unavailable';
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
      if (params.threshold !== undefined) {
        if (!AURORA_THRESHOLDS.includes(params.threshold)) return false;
        if (params.threshold !== threshold) {
          threshold = params.threshold;
          if (enabled) build();
        }
      }
      notify();
      return true;
    },

    getParams() {
      return { threshold };
    },

    getRowControls() {
      const chips = AURORA_THRESHOLDS.map((value) => ({
        id: `threshold:${value}`,
        label: `≥${value}%`,
        active: threshold === value,
        title: `Show cells with at least ${value}% probability of visible aurora`,
        params: { threshold: value },
      }));
      const legend = AURORA_BANDS.filter((band) => band.min >= threshold).map(
        (band) => ({
          label: band.label,
          color: band.color,
        }),
      );
      const lines = [];
      if (snapshot?.grid) {
        const stats = auroraHemisphereStats(snapshot.grid, threshold);
        lines.push(
          `Forecast for ${utcClock(snapshot.forecastAt)} · model run on observations at ${utcClock(snapshot.observedAt)}${snapshot.stale ? ' · STALE (SWPC unreachable, cached)' : ''}`,
          `North: max ${stats.north.maxProbability}%${stats.north.equatorwardLat !== null ? ` · reaches ${stats.north.equatorwardLat}°N` : ''} · South: max ${stats.south.maxProbability}%${stats.south.equatorwardLat !== null ? ` · reaches ${Math.abs(stats.south.equatorwardLat)}°S` : ''}`,
        );
        const observer = cameraObserver(viewer);
        if (observer) {
          const p = ovationProbabilityAt(
            snapshot.grid,
            observer.latDeg,
            observer.lonDeg,
          );
          lines.push(
            `Below camera (${observer.latDeg.toFixed(1)}°, ${observer.lonDeg.toFixed(1)}°): ${p}% probability`,
          );
        }
      } else {
        lines.push(
          loading ? 'Loading OVATION forecast…' : 'No aurora forecast loaded',
        );
      }
      if (error) lines.push(error);
      return {
        chips,
        legend,
        info: lines.join('\n'),
        infoTitle:
          'NOAA SWPC OVATION Prime: probability of visible aurora, a short-term (about 30–90 minute) forecast driven by real-time solar-wind data. Cells are 1°×1° drawn at about 110 km, the base of the auroral emission layer. Visibility also needs darkness and clear skies; aurora can often be seen several hundred kilometres equatorward of the oval when it is overhead elsewhere.',
      };
    },

    setRowControlsListener(value) {
      listener = typeof value === 'function' ? value : null;
    },

    getStats() {
      return {
        count: cellCount,
        countLabel: snapshot?.grid ? `≥${threshold}%` : undefined,
        lastUpdate: snapshot?.fetchedAt ?? null,
        loading,
        error,
        stale: Boolean(snapshot?.stale),
        status:
          error && !snapshot ? 'unavailable' : error ? 'degraded' : 'nominal',
        source: 'NOAA SWPC OVATION',
      };
    },

    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      snapshot = null;
      viewer = null;
      listener = null;
    },
  };
  return layer;
}
