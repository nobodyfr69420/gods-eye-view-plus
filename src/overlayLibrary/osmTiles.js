import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

/**
 * Shared OpenFreeMap (OpenMapTiles schema) vector-tile cache for every OSM
 * overlay. One tile download serves all enabled OSM overlays; tiles are kept
 * in a small LRU and decoded lazily per layer.
 */

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const ALLOWED_ORIGIN = 'https://tiles.openfreemap.org';
const MAX_TILE_BYTES = 6 * 1024 * 1024;

/** Web-Mercator tile containing lon/lat at zoom z. */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (clampedLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.min(n - 1, Math.max(0, x)),
    y: Math.min(n - 1, Math.max(0, y)),
  };
}

/** Tile ground width in metres at a latitude. */
export function tileWidthM(z, lat = 0) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Choose a tile zoom for a camera altitude (≈3 tiles across the view). */
export function zoomForAltitude(altitudeM) {
  const z = Math.round(Math.log2(1.6e8 / Math.max(50, altitudeM)));
  return Math.max(0, Math.min(14, z));
}

/**
 * Tiles around a center within `radiusM`, nearest first, capped at `maxTiles`.
 * Longitude wraps; latitude clamps.
 */
export function tilesAround(lon, lat, z, radiusM, maxTiles = 36) {
  const n = 2 ** z;
  const center = lonLatToTile(lon, lat, z);
  const width = Math.max(1, tileWidthM(z, lat));
  const span = Math.min(
    Math.ceil(radiusM / width),
    Math.ceil(Math.sqrt(maxTiles)) + 2,
    Math.floor(n / 2),
  );
  const tiles = [];
  for (let dy = -span; dy <= span; dy++) {
    const y = center.y + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -span; dx <= span; dx++) {
      const x = (((center.x + dx) % n) + n) % n;
      tiles.push({ z, x, y, d: dx * dx + dy * dy });
    }
  }
  tiles.sort((a, b) => a.d - b.d);
  const seen = new Set();
  const out = [];
  for (const t of tiles) {
    const key = `${t.z}/${t.x}/${t.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ z: t.z, x: t.x, y: t.y, key });
    if (out.length >= maxTiles) break;
  }
  return out;
}

/** Does a vector-tile feature's properties match an overlay's OSM filter? */
export function matchesOsmFilter(filter, properties = {}) {
  if (filter.class && !filter.class.includes(properties.class)) return false;
  if (filter.subclass && !filter.subclass.includes(properties.subclass))
    return false;
  if (filter.where) {
    for (const [key, values] of Object.entries(filter.where)) {
      const v = properties[key];
      if (!values.some((w) => w === v || String(w) === String(v))) return false;
    }
  }
  return true;
}

/** Create the shared tile source. `fetchImpl` is injectable for tests. */
export function createOsmTileSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  maxTiles = 120,
} = {}) {
  let template = null;
  let templatePromise = null;
  const tiles = new Map(); // key → { tile, bytes, at }
  const flights = new Map();
  const stats = { requests: 0, bytes: 0, errors: 0, cached: 0 };

  async function getTemplate() {
    if (template) return template;
    templatePromise ||= (async () => {
      const response = await fetchImpl(TILEJSON_URL, { redirect: 'error' });
      if (!response.ok)
        throw new Error(`OpenFreeMap TileJSON HTTP ${response.status}`);
      const json = await response.json();
      const url = json?.tiles?.[0];
      if (
        typeof url !== 'string' ||
        !url.startsWith(`${ALLOWED_ORIGIN}/`) ||
        !/\{z\}.*\{x\}.*\{y\}/.test(url)
      )
        throw new Error('Invalid OpenFreeMap TileJSON');
      template = url;
      return url;
    })().catch((error) => {
      templatePromise = null;
      throw error;
    });
    return templatePromise;
  }

  async function getTile({ z, x, y, key }, signal) {
    const hit = tiles.get(key);
    if (hit) {
      tiles.delete(key);
      tiles.set(key, hit);
      stats.cached++;
      return hit;
    }
    if (flights.has(key)) return flights.get(key);
    const flight = (async () => {
      const url = (await getTemplate())
        .replace('{z}', z)
        .replace('{x}', x)
        .replace('{y}', y);
      stats.requests++;
      const response = await fetchImpl(url, { signal, redirect: 'error' });
      if (!response.ok) {
        // A missing ocean tile is legitimately empty.
        if (response.status === 404 || response.status === 204)
          return { tile: null, bytes: 0, z, x, y };
        throw new Error(`OpenFreeMap tile HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_TILE_BYTES)
        throw new Error('Vector tile too large');
      stats.bytes += buffer.byteLength;
      const tile = buffer.byteLength
        ? new VectorTile(new PbfReader(new Uint8Array(buffer)))
        : null;
      const entry = { tile, bytes: buffer.byteLength, z, x, y };
      tiles.set(key, entry);
      while (tiles.size > maxTiles) tiles.delete(tiles.keys().next().value);
      return entry;
    })()
      .catch((error) => {
        if (error?.name !== 'AbortError') stats.errors++;
        throw error;
      })
      .finally(() => flights.delete(key));
    flights.set(key, flight);
    return flight;
  }

  /**
   * Extract features from decoded tiles for one overlay filter.
   * Returns GeoJSON-like features (lon/lat). Points from polygons use the
   * outer-ring centroid so POIs mapped as areas still appear as markers.
   */
  function extract(entries, filter, geometry = 'point', limit = 20000) {
    const out = [];
    const seen = new Set();
    for (const entry of entries) {
      const layer = entry?.tile?.layers?.[filter.layer];
      if (!layer) continue;
      for (let i = 0; i < layer.length && out.length < limit; i++) {
        const feature = layer.feature(i);
        const props = feature.properties;
        if (!matchesOsmFilter(filter, props)) continue;
        let geojson;
        try {
          geojson = feature.toGeoJSON(entry.x, entry.y, entry.z);
        } catch {
          continue;
        }
        const g = geojson.geometry;
        const id = feature.id ?? null;
        const dedupeKey = id !== null && geometry === 'point' ? `${id}` : null;
        if (dedupeKey && seen.has(dedupeKey)) continue;
        if (dedupeKey) seen.add(dedupeKey);
        const properties = { ...props };
        if (geometry === 'point') {
          const pt = representativePoint(g);
          if (!pt) continue;
          out.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: pt },
            properties,
          });
        } else {
          out.push({
            type: 'Feature',
            geometry: g,
            properties,
            tile: `${entry.z}/${entry.x}/${entry.y}`,
          });
        }
      }
    }
    return out;
  }

  return {
    getTile,
    extract,
    stats,
    get cachedTiles() {
      return tiles.size;
    },
    clear() {
      tiles.clear();
    },
  };
}

/** A point for any geometry: the point itself, a line midpoint or a ring centroid. */
export function representativePoint(geometry) {
  if (!geometry) return null;
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'MultiPoint':
      return geometry.coordinates[0] || null;
    case 'LineString': {
      const c = geometry.coordinates;
      return c[Math.floor(c.length / 2)] || null;
    }
    case 'MultiLineString': {
      const c = geometry.coordinates[0] || [];
      return c[Math.floor(c.length / 2)] || null;
    }
    case 'Polygon':
      return ringCentroid(geometry.coordinates[0]);
    case 'MultiPolygon':
      return ringCentroid(geometry.coordinates[0]?.[0]);
    default:
      return null;
  }
}

/** Area-weighted centroid of a lon/lat ring (falls back to the vertex mean). */
export function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return ring?.[0] || null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  const [ox, oy] = ring[0];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] - ox;
    const ay = ring[j][1] - oy;
    const bx = ring[i][0] - ox;
    const by = ring[i][1] - oy;
    const cross = ax * by - bx * ay;
    area += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(area) < 1e-14) {
    const n = ring.length;
    return [
      ring.reduce((s, p) => s + p[0], 0) / n,
      ring.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  return [ox + cx / (3 * area), oy + cy / (3 * area)];
}
