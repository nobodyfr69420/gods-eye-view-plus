import * as Cesium from 'cesium';
import { featureColor, featurePriority, featureSize, toHex } from './style.js';
import {
  cleanPath,
  clipRingToRect,
  pathsOf,
  pointsOf,
  polygonsOf,
  ringArea,
  safeLinePaths,
  tilePolygon,
} from './geometryTools.js';
import { representativePoint, ringCentroid } from './osmTiles.js';

/**
 * Cesium rendering for one vector overlay (points, ground lines, ground
 * polygons, extruded footprints) plus its labels on the shared world-overlay
 * canvas (the app forbids Cesium text labels). Everything an overlay creates
 * is owned here and released by destroy().
 */

export const RENDER_LIMITS = Object.freeze({
  points: 60000,
  lines: 25000,
  polygons: 9000,
  extrusions: 6000,
  labels: 160,
});

/** Classify ground geometry onto whatever surface is visible. */
export function classificationForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/** Label/marker anchor: polygons use the centroid of their ±80° part so
 * pole-to-pole shapes (time zones) are labeled mid-latitude. */
export function labelAnchor(geometry) {
  let best = null;
  let bestArea = 0;
  for (const rings of polygonsOf(geometry)) {
    const clipped = clipRingToRect(rings[0] || [], [-180, -80, 180, 80]);
    if (clipped.length < 4) continue;
    const area = Math.abs(ringArea(clipped));
    if (area > bestArea) {
      bestArea = area;
      best = clipped;
    }
  }
  if (best) {
    const c = ringCentroid(best);
    if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) return c;
  }
  return representativePoint(geometry);
}

const color = ([r, g, b, a], alpha) =>
  new Cesium.Color(r, g, b, Math.max(0, Math.min(1, a * alpha)));

/** Swap a primitive in only once its replacement is ready, avoiding flicker. */
function swapWhenReady(scene, collection, previous, next, onSwap) {
  if (!next) {
    if (previous && !previous.isDestroyed?.()) collection.remove(previous);
    onSwap?.();
    return () => {};
  }
  collection.add(next);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    remove();
    if (previous && !previous.isDestroyed?.()) collection.remove(previous);
    onSwap?.();
  };
  const remove = scene.postRender.addEventListener(() => {
    if (next.isDestroyed?.()) return finish();
    if (next.ready) finish();
  });
  // Never keep a stale primitive more than a few seconds.
  const timer = setTimeout(finish, 6000);
  return () => {
    clearTimeout(timer);
    finish();
  };
}

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {object} options.def Overlay definition.
 * @param {object} [options.overlayHost] World-overlay host for labels.
 */
export function createRenderSet({ viewer, def, overlayHost }) {
  const scene = viewer.scene;
  const style = def.style || {};
  const labelSource = `ovl:${def.id}`;
  const labelProp = style.label === undefined ? null : style.label;
  const labelMax = Math.min(RENDER_LIMITS.labels, style.labelMax ?? 40);
  let alpha = 1;
  let visible = true;
  let destroyed = false;
  let features = [];
  let points = null;
  let pointRecords = [];
  let linePrimitive = null;
  let fillPrimitive = null;
  let extrudePrimitive = null;
  let pendingSwaps = [];
  let labelAnchors = [];
  let counts = { points: 0, lines: 0, polygons: 0, extrusions: 0, total: 0 };
  let rebuildTimer = null;
  let builtAt = 0;

  const pickId = (index) => ({ gevOverlay: def.id, index });

  function geometryMode(feature) {
    const g = feature?.geometry?.type;
    const mode = def.geometry || 'point';
    if (mode === 'point') return 'point';
    if (mode === 'line')
      return g === 'Point' || g === 'MultiPoint' ? 'point' : 'line';
    if (mode === 'polygon')
      return g === 'Polygon' || g === 'MultiPolygon'
        ? 'polygon'
        : g === 'LineString' || g === 'MultiLineString'
          ? 'line'
          : 'point';
    // auto / mixed
    if (g === 'Polygon' || g === 'MultiPolygon') return 'polygon';
    if (g === 'LineString' || g === 'MultiLineString') return 'line';
    return 'point';
  }

  function clearPoints() {
    if (points && !points.isDestroyed()) {
      scene.primitives.remove(points);
    }
    points = null;
    pointRecords = [];
  }

  function build() {
    if (destroyed) return;
    for (const cancel of pendingSwaps) cancel();
    pendingSwaps = [];
    clearPoints();
    labelAnchors = [];
    counts = { points: 0, lines: 0, polygons: 0, extrusions: 0, total: 0 };
    builtAt = Date.now();
    const classificationType = classificationForScene(scene);
    const lineInstances = [];
    const fillInstances = [];
    const extrudeInstances = [];
    const pointCollection = new Cesium.PointPrimitiveCollection({
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    });
    const lineWidth = Number(style.width ?? 2);
    const lineAlpha = Number(style.alpha ?? 0.92);
    const fillAlpha = Number(style.fill ?? 0);
    const extrude = style.extrude;
    let baseHeight = 0;
    if (extrude && scene.globe?.show) {
      const center = viewer.camera.positionCartographic;
      const sampled = center ? scene.globe.getHeight(center) : undefined;
      if (Number.isFinite(sampled)) baseHeight = sampled;
    }

    for (let index = 0; index < features.length; index++) {
      const feature = features[index];
      const props = feature.properties || {};
      const rgba = featureColor(style, props);
      const mode = geometryMode(feature);
      const anchor = labelAnchor(feature.geometry);
      if (mode === 'point') {
        const pts = pointsOf(feature.geometry);
        const list = pts.length ? pts : anchor ? [anchor] : [];
        for (const [lon, lat] of list) {
          if (counts.points >= RENDER_LIMITS.points) break;
          const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
          const point = pointCollection.add({
            id: pickId(index),
            position,
            pixelSize: featureSize(style, props),
            color: color(rgba, alpha * 0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.7 * alpha),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(3e5, 1.0, 2.2e7, 0.55),
          });
          pointRecords.push({ point, position });
          counts.points++;
        }
      } else if (mode === 'line') {
        for (const clean of pathsOf(feature.geometry).flatMap((path) =>
          safeLinePaths(path),
        )) {
          if (counts.lines >= RENDER_LIMITS.lines) break;
          lineInstances.push(
            new Cesium.GeometryInstance({
              id: pickId(index),
              geometry: new Cesium.GroundPolylineGeometry({
                positions: Cesium.Cartesian3.fromDegreesArray(clean.flat()),
                width: lineWidth,
                arcType: Cesium.ArcType.GEODESIC,
              }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  color(rgba, alpha * lineAlpha),
                ),
              },
            }),
          );
          counts.lines++;
        }
      } else if (mode === 'polygon') {
        const polygons = polygonsOf(feature.geometry);
        if (extrude) {
          const height = Number(props[extrude.prop]);
          if (
            !Number.isFinite(height) ||
            height < (extrude.min ?? 0) ||
            props.hide_3d
          )
            continue;
          const minHeight = Number(props.render_min_height) || 0;
          for (const rings of polygons) {
            if (counts.extrusions >= RENDER_LIMITS.extrusions) break;
            const outer = cleanPath(rings[0]);
            if (!outer || outer.length < 3) continue;
            extrudeInstances.push(
              new Cesium.GeometryInstance({
                id: pickId(index),
                geometry: new Cesium.PolygonGeometry({
                  polygonHierarchy: new Cesium.PolygonHierarchy(
                    Cesium.Cartesian3.fromDegreesArray(outer.flat()),
                  ),
                  height: baseHeight + minHeight,
                  extrudedHeight: baseHeight + height,
                  vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                  color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                    color(
                      featureColor(
                        {
                          ...style,
                          colorBy: {
                            prop: extrude.prop,
                            stops: [
                              [25, '#1f6f8b'],
                              [80, '#00d4ff'],
                              [200, '#b6f3ff'],
                              [400, '#ffffff'],
                            ],
                          },
                        },
                        props,
                      ),
                      alpha * Math.max(0.2, fillAlpha || 0.6),
                    ),
                  ),
                },
              }),
            );
            counts.extrusions++;
          }
        } else {
          for (const rings of polygons) {
            if (counts.polygons >= RENDER_LIMITS.polygons) break;
            if (fillAlpha > 0) {
              for (const piece of tilePolygon(rings)) {
                const outer = cleanPath(piece[0]);
                if (!outer || outer.length < 3) continue;
                const holes = piece
                  .slice(1)
                  .map(cleanPath)
                  .filter((h) => h && h.length >= 3)
                  .map(
                    (h) =>
                      new Cesium.PolygonHierarchy(
                        Cesium.Cartesian3.fromDegreesArray(h.flat()),
                      ),
                  );
                fillInstances.push(
                  new Cesium.GeometryInstance({
                    id: pickId(index),
                    geometry: new Cesium.PolygonGeometry({
                      polygonHierarchy: new Cesium.PolygonHierarchy(
                        Cesium.Cartesian3.fromDegreesArray(outer.flat()),
                        holes,
                      ),
                      vertexFormat:
                        Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
                      arcType: Cesium.ArcType.RHUMB,
                    }),
                    attributes: {
                      color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                        color(rgba, alpha * fillAlpha),
                      ),
                    },
                  }),
                );
              }
            }
            if (lineWidth > 0) {
              for (const clean of rings.flatMap((ring) =>
                safeLinePaths(ring),
              )) {
                const outline = style.outlineColor
                  ? [...featureColor({ color: style.outlineColor }, {})]
                  : rgba;
                lineInstances.push(
                  new Cesium.GeometryInstance({
                    id: pickId(index),
                    geometry: new Cesium.GroundPolylineGeometry({
                      positions: Cesium.Cartesian3.fromDegreesArray(
                        clean.flat(),
                      ),
                      width: lineWidth,
                      arcType: Cesium.ArcType.RHUMB,
                    }),
                    attributes: {
                      color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                        color(outline, alpha * lineAlpha),
                      ),
                    },
                  }),
                );
              }
            }
            counts.polygons++;
          }
        }
      }
      if (
        labelProp &&
        anchor &&
        props[labelProp] !== undefined &&
        props[labelProp] !== null
      ) {
        labelAnchors.push({
          index,
          lon: anchor[0],
          lat: anchor[1],
          text: String(props[labelProp]).slice(0, 48),
          priority: featurePriority(style, props),
          accent: toHex(rgba),
        });
      }
    }
    counts.total =
      counts.points + counts.lines + counts.polygons + counts.extrusions;

    if (pointRecords.length) {
      points = scene.primitives.add(pointCollection);
      points.show = visible;
    } else {
      pointCollection.destroy();
    }

    const nextLine = lineInstances.length
      ? new Cesium.GroundPolylinePrimitive({
          geometryInstances: lineInstances,
          appearance: new Cesium.PolylineColorAppearance(),
          classificationType,
          asynchronous: true,
          releaseGeometryInstances: true,
          allowPicking: true,
        })
      : null;
    if (nextLine) nextLine.show = visible;
    pendingSwaps.push(
      swapWhenReady(scene, scene.groundPrimitives, linePrimitive, nextLine),
    );
    linePrimitive = nextLine;

    const nextFill = fillInstances.length
      ? new Cesium.GroundPrimitive({
          geometryInstances: fillInstances,
          appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: true,
          }),
          classificationType,
          asynchronous: true,
          releaseGeometryInstances: true,
          allowPicking: true,
        })
      : null;
    if (nextFill) nextFill.show = visible;
    pendingSwaps.push(
      swapWhenReady(scene, scene.groundPrimitives, fillPrimitive, nextFill),
    );
    fillPrimitive = nextFill;

    const nextExtrude = extrudeInstances.length
      ? new Cesium.Primitive({
          geometryInstances: extrudeInstances,
          appearance: new Cesium.PerInstanceColorAppearance({
            translucent: true,
            closed: true,
          }),
          asynchronous: true,
          releaseGeometryInstances: true,
          allowPicking: true,
        })
      : null;
    if (nextExtrude) nextExtrude.show = visible;
    pendingSwaps.push(
      swapWhenReady(scene, scene.primitives, extrudePrimitive, nextExtrude),
    );
    extrudePrimitive = nextExtrude;
    scene.requestRender?.();
  }

  function scheduleRebuild(delay = 120) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(build, delay);
  }

  /** Hide points behind the Earth (they draw without depth testing). */
  function cull(occluder) {
    if (!points || !visible) return;
    for (const record of pointRecords) {
      const v = occluder.isPointVisible(record.position);
      if (record.point.show !== v) record.point.show = v;
    }
  }

  /** Publish up to `labelMax` labels for features inside the view rectangle. */
  function updateLabels(rect) {
    if (!overlayHost || !labelProp || labelMax <= 0) return;
    if (!visible || !labelAnchors.length) {
      overlayHost.clearSource(labelSource);
      return;
    }
    const inView = rect
      ? labelAnchors.filter((a) => {
          const lon = a.lon * Cesium.Math.RADIANS_PER_DEGREE;
          const lat = a.lat * Cesium.Math.RADIANS_PER_DEGREE;
          if (lat < rect.south || lat > rect.north) return false;
          if (rect.west <= rect.east)
            return lon >= rect.west && lon <= rect.east;
          return lon >= rect.west || lon <= rect.east;
        })
      : labelAnchors;
    const chosen = inView
      .slice()
      .sort((a, b) => b.priority - a.priority || a.index - b.index)
      .slice(0, labelMax);
    overlayHost.setEntries(
      labelSource,
      chosen.map((a) => ({
        id: String(a.index),
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0),
        variant: 'label',
        title: a.text,
        accent: a.accent,
        priority: Math.round(a.priority * 100) || labelMax - chosen.indexOf(a),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 10,
        verticalOnly: true,
        placement: 'above',
        distanceScale: { near: 4e5, nearValue: 1, far: 2.2e7, farValue: 0.6 },
      })),
      { cohortLimit: labelMax, moving: false },
    );
    overlayHost.setVisible(labelSource, true);
  }

  return {
    setFeatures(next) {
      features = Array.isArray(next) ? next : [];
      build();
    },
    rebuild: () => scheduleRebuild(0),
    setAlpha(value) {
      const next = Math.max(0, Math.min(1, Number(value)));
      if (next === alpha) return;
      alpha = next;
      scheduleRebuild();
    },
    setVisible(value) {
      visible = value !== false;
      if (points) points.show = visible;
      if (linePrimitive) linePrimitive.show = visible;
      if (fillPrimitive) fillPrimitive.show = visible;
      if (extrudePrimitive) extrudePrimitive.show = visible;
      if (!visible) overlayHost?.clearSource(labelSource);
      scene.requestRender?.();
    },
    cull,
    updateLabels,
    getFeature: (index) => features[index] || null,
    get features() {
      return features;
    },
    get counts() {
      return counts;
    },
    get builtAt() {
      return builtAt;
    },
    destroy() {
      destroyed = true;
      clearTimeout(rebuildTimer);
      for (const cancel of pendingSwaps) cancel();
      pendingSwaps = [];
      clearPoints();
      for (const [collection, primitive] of [
        [scene.groundPrimitives, linePrimitive],
        [scene.groundPrimitives, fillPrimitive],
        [scene.primitives, extrudePrimitive],
      ]) {
        if (primitive && !primitive.isDestroyed?.())
          collection.remove(primitive);
      }
      linePrimitive = fillPrimitive = extrudePrimitive = null;
      if (overlayHost) {
        overlayHost.clearSource(labelSource);
        overlayHost.setVisible(labelSource, false);
      }
      features = [];
      scene.requestRender?.();
    },
  };
}
