import * as Cesium from 'cesium';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';
import {
  footprintRadiusKm,
  footprintRing,
  groundTrackSampleTimes,
} from './model.js';

/** Height the ground track and footprint rings are drawn at, metres. Lifted
 * slightly off the ellipsoid so terrain does not swallow them at globe scale. */
export const ORBIT_SURFACE_HEIGHT_M = 12_000;
/** Elevation masks drawn as footprint rings, degrees. */
export const FOOTPRINT_MASKS_DEG = Object.freeze([0, 10]);
/** Recompute the drawn ground track at most this often, ms. */
const TRACK_REFRESH_MS = 30_000;

/** Build an SGP4 record, or null for an unusable TLE. */
export function satrecFromTle(line1, line2) {
  try {
    const satrec = twoline2satrec(line1, line2);
    return satrec && !satrec.error ? satrec : null;
  } catch {
    return null;
  }
}

/**
 * SGP4 geodetic position.
 * @param {object} satrec
 * @param {Date} date
 * @returns {{latitude:number, longitude:number, altitude:number, speedMps:number|null}|null}
 *   altitude in metres.
 */
export function propagateGeodetic(satrec, date) {
  try {
    const pv = propagate(satrec, date);
    const p = pv?.position;
    if (!p || typeof p === 'boolean' || ![p.x, p.y, p.z].every(Number.isFinite))
      return null;
    const geo = eciToGeodetic(p, gstime(date));
    const v =
      pv.velocity && typeof pv.velocity !== 'boolean' ? pv.velocity : null;
    return {
      latitude: degreesLat(geo.latitude),
      longitude: degreesLong(geo.longitude),
      altitude: geo.height * 1000,
      speedMps: v ? Math.hypot(v.x, v.y, v.z) * 1000 : null,
    };
  } catch {
    return null;
  }
}

/**
 * Point cloud of live SGP4 positions, refreshed round-robin so the per-frame
 * cost stays bounded with tens of thousands of objects.
 * @param {{viewer: object, idPrefix: string, refreshFrames?: number, cesium?: object}} options
 */
export function createSatellitePoints({
  viewer,
  idPrefix,
  refreshFrames = 120,
  cesium = Cesium,
}) {
  const collection = viewer.scene.primitives.add(
    new cesium.PointPrimitiveCollection(),
  );
  collection.show = false;
  /** @type {Map<number, {point: object, satrec: object, record: object}>} */
  const items = new Map();
  let order = [];
  let cursor = 0;
  const colorCache = new Map();
  const colorFor = (css, alpha = 1) => {
    const key = `${css}:${alpha}`;
    if (!colorCache.has(key))
      colorCache.set(
        key,
        cesium.Color.fromCssColorString(css).withAlpha(alpha),
      );
    return colorCache.get(key);
  };

  function place(item, date) {
    const pos = propagateGeodetic(item.satrec, date);
    if (!pos) {
      item.point.show = false;
      item.position = null;
      return;
    }
    item.position = pos;
    item.point.show = item.visible !== false;
    item.point.position = cesium.Cartesian3.fromDegrees(
      pos.longitude,
      pos.latitude,
      pos.altitude,
    );
  }

  return {
    collection,
    items,
    /**
     * Replace every point.
     * @param {Array<{norad:number, line1:string, line2:string}>} records
     * @param {(record:object) => {color:string, pixelSize?:number}} styleFor
     */
    setRecords(records, styleFor) {
      collection.removeAll();
      items.clear();
      const now = new Date();
      for (const record of records) {
        const satrec = satrecFromTle(record.line1, record.line2);
        if (!satrec) continue;
        const style = styleFor(record);
        const point = collection.add({
          id: `${idPrefix}${record.norad}`,
          pixelSize: style.pixelSize ?? 4,
          color: colorFor(style.color, style.alpha ?? 0.95),
          outlineColor: colorFor('#000000', 0.55),
          outlineWidth: style.outlineWidth ?? 1,
          scaleByDistance: new cesium.NearFarScalar(1.5e6, 1.6, 4e7, 0.7),
        });
        const item = { point, satrec, record, position: null };
        place(item, now);
        items.set(record.norad, item);
      }
      order = [...items.keys()];
      cursor = 0;
    },
    /** Restyle one point (selection highlight). */
    restyle(norad, style) {
      const item = items.get(norad);
      if (!item) return;
      item.point.pixelSize = style.pixelSize ?? 4;
      item.point.color = colorFor(style.color, style.alpha ?? 0.95);
      item.point.outlineColor = colorFor(style.outlineColor || '#000000', 0.8);
      item.point.outlineWidth = style.outlineWidth ?? 1;
    },
    /** Propagate one bounded slice; always refreshes `priority` ids. */
    tick(date = new Date(), priority = []) {
      for (const norad of priority) {
        const item = items.get(norad);
        if (item) place(item, date);
      }
      if (!order.length) return;
      const perFrame = Math.max(1, Math.ceil(order.length / refreshFrames));
      for (let i = 0; i < perFrame; i++) {
        if (cursor >= order.length) cursor = 0;
        const item = items.get(order[cursor++]);
        if (item) place(item, date);
      }
    },
    /** Norad id behind a scene pick, or null. */
    pickNorad(picked) {
      const id = picked?.primitive?.id ?? picked?.id;
      if (typeof id !== 'string' || !id.startsWith(idPrefix)) return null;
      const norad = Number(id.slice(idPrefix.length));
      return items.has(norad) ? norad : null;
    },
    ownsPickId(id) {
      return typeof id === 'string' && id.startsWith(idPrefix);
    },
    setShow(show) {
      collection.show = Boolean(show);
    },
    destroy() {
      items.clear();
      order = [];
      if (!collection.isDestroyed?.())
        viewer.scene.primitives.remove(collection);
    },
  };
}

/**
 * Ground track (past dim, future bright) and footprint rings for one selected
 * object. Owns one PolylineCollection.
 * @param {{viewer: object, cesium?: object}} options
 */
export function createSelectionGraphics({ viewer, cesium = Cesium }) {
  const collection = viewer.scene.primitives.add(
    new cesium.PolylineCollection(),
  );
  collection.show = false;
  let lines = null;
  let subject = null;
  let trackBuiltAt = -Infinity;

  const setLine = (line, points) => {
    if (points.length < 2) {
      line.show = false;
      return;
    }
    line.positions = toCartesians(points);
    line.show = true;
  };
  const toCartesians = (points) =>
    points.map((p) =>
      cesium.Cartesian3.fromDegrees(
        p.longitude,
        p.latitude,
        ORBIT_SURFACE_HEIGHT_M,
      ),
    );

  function ensureLines(color) {
    if (lines) return;
    const css = cesium.Color.fromCssColorString(color);
    const make = (alpha, width, dash = false) =>
      collection.add({
        show: false,
        positions: [cesium.Cartesian3.ZERO, cesium.Cartesian3.UNIT_X],
        width,
        material: dash
          ? cesium.Material.fromType('PolylineDash', {
              color: css.withAlpha(alpha),
              dashLength: 12,
            })
          : cesium.Material.fromType('Color', { color: css.withAlpha(alpha) }),
      });
    lines = {
      past: make(0.35, 1.5),
      future: make(0.85, 2),
      footprints: FOOTPRINT_MASKS_DEG.map((mask, i) =>
        make(i === 0 ? 0.7 : 0.45, i === 0 ? 1.5 : 1, i > 0),
      ),
    };
  }

  return {
    /**
     * @param {{satrec:object, record:{summary:{periodMin:number}}, color:string}|null} next
     */
    setSubject(next) {
      if (!next) {
        subject = null;
        collection.removeAll();
        lines = null;
        collection.show = false;
        return;
      }
      if (subject?.satrec !== next.satrec) {
        collection.removeAll();
        lines = null;
        trackBuiltAt = -Infinity;
      }
      subject = next;
      ensureLines(next.color);
      collection.show = true;
    },
    /** Rebuild the footprint every call and the track when it ages out. */
    update(nowMs = Date.now()) {
      if (!subject || !lines) return null;
      const now = new Date(nowMs);
      const here = propagateGeodetic(subject.satrec, now);
      if (!here) return null;
      if (nowMs - trackBuiltAt > TRACK_REFRESH_MS) {
        trackBuiltAt = nowMs;
        const times = groundTrackSampleTimes(
          nowMs,
          subject.record.summary.periodMin,
        );
        const past = [];
        const future = [];
        for (const t of times) {
          const p = propagateGeodetic(subject.satrec, new Date(t));
          if (!p) continue;
          if (t <= nowMs) past.push(p);
          if (t >= nowMs) future.push(p);
        }
        setLine(lines.past, past);
        setLine(lines.future, future);
      }
      FOOTPRINT_MASKS_DEG.forEach((mask, i) => {
        const ring = footprintRing(
          here.latitude,
          here.longitude,
          footprintRadiusKm(here.altitude / 1000, mask),
        );
        setLine(lines.footprints[i], ring);
      });
      return here;
    },
    setShow(show) {
      collection.show = Boolean(show) && Boolean(subject);
    },
    destroy() {
      subject = null;
      lines = null;
      if (!collection.isDestroyed?.())
        viewer.scene.primitives.remove(collection);
    },
  };
}
