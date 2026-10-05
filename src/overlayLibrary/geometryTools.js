/**
 * Pure lon/lat geometry helpers used before handing shapes to Cesium.
 * Cesium triangulates a polygon on a tangent plane, which breaks for shapes
 * spanning a large part of the globe (time-zone strips, Antarctica). Large
 * polygons are therefore clipped into ≤30° cells first.
 */

/** [west, south, east, north] of a ring. */
export function ringBbox(ring) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

function clipEdge(points, inside, intersect) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const prev = points[(i + points.length - 1) % points.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) out.push(intersect(prev, cur));
  }
  return out;
}

/** Sutherland–Hodgman clip of a (closed or open) ring to a lon/lat rectangle. */
export function clipRingToRect(ring, [w, s, e, n]) {
  let pts = ring.slice();
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  const lerpX = (p, q, x) => [
    x,
    p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0]),
  ];
  const lerpY = (p, q, y) => [
    p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]),
    y,
  ];
  pts = clipEdge(
    pts,
    (p) => p[0] >= w,
    (p, q) => lerpX(p, q, w),
  );
  if (!pts.length) return [];
  pts = clipEdge(
    pts,
    (p) => p[0] <= e,
    (p, q) => lerpX(p, q, e),
  );
  if (!pts.length) return [];
  pts = clipEdge(
    pts,
    (p) => p[1] >= s,
    (p, q) => lerpY(p, q, s),
  );
  if (!pts.length) return [];
  pts = clipEdge(
    pts,
    (p) => p[1] <= n,
    (p, q) => lerpY(p, q, n),
  );
  if (pts.length < 3) return [];
  pts.push(pts[0]);
  return pts;
}

/** Signed area (lon/lat units). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/**
 * Split polygon rings (outer + holes) into pieces no larger than `cellDeg`,
 * also clamping to ±maxLat. Small polygons pass through unchanged (clamped).
 * @returns {Array<Array<Array<[number, number]>>>} list of polygons (rings).
 */
export function tilePolygon(rings, { cellDeg = 30, maxLat = 85 } = {}) {
  if (!Array.isArray(rings) || !rings[0] || rings[0].length < 4) return [];
  const [w, s, e, n] = ringBbox(rings[0]);
  const south = Math.max(s, -maxLat);
  const north = Math.min(n, maxLat);
  if (north <= south) return [];
  const small = e - w <= cellDeg && north - south <= cellDeg;
  if (small && s >= -maxLat && n <= maxLat) return [rings];
  const pieces = [];
  const x0 = small ? w : Math.floor(w / cellDeg) * cellDeg;
  const y0 = small ? south : Math.floor(south / cellDeg) * cellDeg;
  const stepX = small ? e - w || 1 : cellDeg;
  const stepY = small ? north - south || 1 : cellDeg;
  for (let x = x0; x < e; x += stepX) {
    for (let y = y0; y < north; y += stepY) {
      const rect = [
        x,
        Math.max(y, south),
        Math.min(x + stepX, e),
        Math.min(y + stepY, north),
      ];
      if (rect[2] <= rect[0] || rect[3] <= rect[1]) continue;
      const outer = clipRingToRect(rings[0], rect);
      if (outer.length < 4 || Math.abs(ringArea(outer)) < 1e-10) continue;
      const holes = rings
        .slice(1)
        .map((h) => clipRingToRect(h, rect))
        .filter((h) => h.length >= 4 && Math.abs(ringArea(h)) > 1e-10);
      pieces.push([outer, ...holes]);
    }
  }
  return pieces;
}

/** Iterate polygons of a Polygon / MultiPolygon geometry. */
export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Iterate line paths of any line or polygon geometry (polygon → its rings). */
export function pathsOf(geometry) {
  if (!geometry) return [];
  switch (geometry.type) {
    case 'LineString':
      return [geometry.coordinates];
    case 'MultiLineString':
      return geometry.coordinates;
    case 'Polygon':
      return geometry.coordinates;
    case 'MultiPolygon':
      return geometry.coordinates.flat();
    default:
      return [];
  }
}

/** Points of a Point / MultiPoint geometry. */
export function pointsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'MultiPoint') return geometry.coordinates;
  return [];
}

/** Remove consecutive duplicate vertices and drop paths shorter than 2 points. */
export function cleanPath(path) {
  const out = [];
  for (const p of path || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      continue;
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last[0] - p[0]) < 1e-9 &&
      Math.abs(last[1] - p[1]) < 1e-9
    )
      continue;
    out.push(p);
  }
  return out.length >= 2 ? out : null;
}

/**
 * Make a lon/lat path safe for ground polylines: drop vertices poleward of
 * ±maxLat (pole-edge vertices collapse to one point on the globe and give
 * Cesium degenerate segments), split where the path jumps across the
 * antimeridian, and drop consecutive near-duplicates. Returns 0..n paths.
 */
export function safeLinePaths(path, { maxLat = 85 } = {}) {
  const parts = [];
  let current = [];
  const flush = () => {
    const clean = cleanPath(current);
    if (clean) parts.push(clean);
    current = [];
  };
  for (const p of path || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      continue;
    if (Math.abs(p[1]) > maxLat) {
      flush();
      continue;
    }
    const last = current[current.length - 1];
    if (last && Math.abs(p[0] - last[0]) > 180) flush();
    current.push(p);
  }
  flush();
  return parts;
}

/** Bounding box intersection test for [w,s,e,n] boxes. */
export function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
