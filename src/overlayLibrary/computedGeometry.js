/**
 * Pure astronomy and grid geometry for the Overlay Library's computed
 * overlays. Everything is in degrees and returns GeoJSON-like features, so it
 * is unit-testable without Cesium. Sun and moon use the low-precision series
 * popularised by suncalc (accurate to a fraction of a degree), which is far
 * finer than a globe overlay can show.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = 23.4397 * RAD;
export const EARTH_RADIUS_M = 6_371_008.8;

const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
export const normalizeLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Greenwich mean sidereal time in degrees. */
export function gmstDegrees(date) {
  const d = toDays(date);
  return (((280.16 + 360.9856235 * d) % 360) + 360) % 360;
}

function eclipticToEquatorial(lambda, beta) {
  const ra = Math.atan2(
    Math.sin(lambda) * Math.cos(OBLIQUITY) -
      Math.tan(beta) * Math.sin(OBLIQUITY),
    Math.cos(lambda),
  );
  const dec = Math.asin(
    Math.sin(beta) * Math.cos(OBLIQUITY) +
      Math.cos(beta) * Math.sin(OBLIQUITY) * Math.sin(lambda),
  );
  return { ra, dec };
}

function sunEcliptic(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C =
    RAD *
    (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return { lambda: M + C + P + Math.PI, M };
}

/** Sub-solar point {lat, lon} and declination for a date. */
export function subsolarPoint(date = new Date()) {
  const d = toDays(date);
  const { lambda } = sunEcliptic(d);
  const { ra, dec } = eclipticToEquatorial(lambda, 0);
  return {
    lat: dec * DEG,
    lon: normalizeLon(ra * DEG - gmstDegrees(date)),
    declination: dec * DEG,
  };
}

/** Sub-lunar point, distance (km) and illuminated fraction for a date. */
export function sublunarPoint(date = new Date()) {
  const d = toDays(date);
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const lambda = L + RAD * 6.289 * Math.sin(M);
  const beta = RAD * 5.128 * Math.sin(F);
  const distanceKm = 385001 - 20905 * Math.cos(M);
  const { ra, dec } = eclipticToEquatorial(lambda, beta);
  // Illumination (suncalc's getMoonIllumination).
  const sun = sunEcliptic(d);
  const s = eclipticToEquatorial(sun.lambda, 0);
  const sdist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(dec) +
      Math.cos(s.dec) * Math.cos(dec) * Math.cos(s.ra - ra),
  );
  const inc = Math.atan2(
    sdist * Math.sin(phi),
    distanceKm - sdist * Math.cos(phi),
  );
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - ra),
    Math.sin(s.dec) * Math.cos(dec) -
      Math.cos(s.dec) * Math.sin(dec) * Math.cos(s.ra - ra),
  );
  const fraction = (1 + Math.cos(inc)) / 2;
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  return {
    lat: dec * DEG,
    lon: normalizeLon(ra * DEG - gmstDegrees(date)),
    distanceKm,
    fraction,
    phase,
  };
}

/** Name of a moon phase from suncalc's 0..1 phase and illuminated fraction. */
export function moonPhaseName(phase, fraction) {
  const p = ((phase % 1) + 1) % 1;
  const f = Number.isFinite(fraction)
    ? fraction
    : (1 - Math.cos(p * 2 * Math.PI)) / 2;
  const waxing = p < 0.5;
  if (f < 0.03) return 'New Moon';
  if (f > 0.97) return 'Full Moon';
  if (Math.abs(f - 0.5) < 0.06)
    return waxing ? 'First Quarter' : 'Last Quarter';
  if (f < 0.5) return waxing ? 'Waxing Crescent' : 'Waning Crescent';
  return waxing ? 'Waxing Gibbous' : 'Waning Gibbous';
}

/** Solar elevation angle (degrees) at a place and time. */
export function solarElevation(
  lat,
  lon,
  date = new Date(),
  sun = subsolarPoint(date),
) {
  const phi = lat * RAD;
  const dec = sun.lat * RAD;
  const h = (lon - sun.lon) * RAD;
  return (
    Math.asin(
      Math.sin(phi) * Math.sin(dec) +
        Math.cos(phi) * Math.cos(dec) * Math.cos(h),
    ) * DEG
  );
}

/** Destination point from (lat, lon) along bearing (deg) for angular distance (deg). */
export function destination(lat, lon, bearingDeg, angularDeg) {
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const b = bearingDeg * RAD;
  const d = angularDeg * RAD;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [normalizeLon(l2 * DEG), p2 * DEG];
}

/** Great-circle angular distance in degrees. */
export function angularDistance(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) *
      Math.cos(lat2 * RAD) *
      Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * DEG;
}

/**
 * Split a lon/lat path wherever it jumps across the antimeridian, so ground
 * lines never draw a seam across the whole globe.
 */
export function splitAtAntimeridian(points) {
  const parts = [];
  let current = [];
  for (const p of points) {
    const last = current[current.length - 1];
    if (last && Math.abs(p[0] - last[0]) > 180) {
      if (current.length > 1) parts.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

/** Small circle of angular radius around a center, as split line parts. */
export function smallCircle(lat, lon, angularDeg, segments = 180) {
  const pts = [];
  for (let i = 0; i <= segments; i++)
    pts.push(destination(lat, lon, (i / segments) * 360, angularDeg));
  return splitAtAntimeridian(pts);
}

const line = (parts, properties) =>
  parts.length === 1
    ? {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: parts[0] },
        properties,
      }
    : {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: parts },
        properties,
      };
const point = (lon, lat, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

/** Circle where the sun sits `depression` degrees below the horizon (0 = terminator). */
export function twilightFeature(
  date = new Date(),
  depression = 0,
  name = null,
) {
  const sun = subsolarPoint(date);
  return line(smallCircle(sun.lat, sun.lon, 90 + depression), {
    name:
      name || (depression ? `Sun ${depression}° below horizon` : 'Terminator'),
  });
}

/** Latitude/longitude grid lines every `step` degrees, optionally within bounds. */
export function graticuleFeatures(step = 10, bounds = null) {
  const b = bounds || { west: -180, south: -90, east: 180, north: 90 };
  const features = [];
  const lonStart = Math.ceil(b.west / step) * step;
  const latStart = Math.ceil(b.south / step) * step;
  const south = Math.max(-89.9, b.south);
  const north = Math.min(89.9, b.north);
  const res = Math.max(0.25, Math.min(2, step / 4));
  for (let lon = lonStart; lon <= b.east + 1e-9; lon += step) {
    if (lon > 180 || (lon === 180 && b.west <= -180)) break;
    const coords = [];
    for (let lat = south; lat <= north + 1e-9; lat += res)
      coords.push([lon, Math.min(lat, north)]);
    if (coords.length > 1)
      features.push(
        line([coords], {
          name: `${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 ? 'E' : ''}`,
          kind: 'meridian',
        }),
      );
  }
  for (let lat = latStart; lat <= b.north + 1e-9; lat += step) {
    if (Math.abs(lat) >= 90) continue;
    const coords = [];
    for (
      let lon = Math.max(-180, b.west);
      lon <= Math.min(180, b.east) + 1e-9;
      lon += res
    )
      coords.push([Math.min(lon, 180), lat]);
    if (coords.length > 1)
      features.push(
        line([coords], {
          name: `${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}`,
          kind: 'parallel',
        }),
      );
  }
  return features;
}

function parallel(lat, name) {
  const coords = [];
  for (let lon = -180; lon <= 180; lon += 1) coords.push([lon, lat]);
  return line([coords], { name, latitude: lat });
}
function meridian(lon, name, south = -89.9, north = 89.9) {
  const coords = [];
  for (let lat = south; lat <= north + 1e-9; lat += 1)
    coords.push([lon, Math.min(lat, north)]);
  return line([coords], { name, longitude: lon });
}

/** Axial tilt for a date (IAU 2006 linear term is enough here). */
export function axialTilt(date = new Date()) {
  const centuries = toDays(date) / 36525;
  return 23.439279 - 0.0130102 * centuries;
}

/** Equator, tropics and polar circles for the date. */
export function keyParallelFeatures(date = new Date()) {
  const tilt = axialTilt(date);
  return [
    parallel(0, 'Equator'),
    parallel(tilt, `Tropic of Cancer (${tilt.toFixed(2)}°N)`),
    parallel(-tilt, `Tropic of Capricorn (${tilt.toFixed(2)}°S)`),
    parallel(90 - tilt, `Arctic Circle (${(90 - tilt).toFixed(2)}°N)`),
    parallel(tilt - 90, `Antarctic Circle (${(90 - tilt).toFixed(2)}°S)`),
  ];
}

/** Prime meridian and antimeridian. */
export function meridianFeatures() {
  return [
    meridian(0, 'Prime Meridian (0°)'),
    meridian(180, 'Antimeridian (180°)'),
  ];
}

const UTM_BANDS = 'CDEFGHJKLMNPQRSTUVWX';

/** UTM zone boundaries (with the Norway and Svalbard exceptions) plus zone labels. */
export function utmFeatures() {
  const features = [];
  const bandSouth = (i) => -80 + i * 8;
  const bandNorth = (i) => (i === 19 ? 84 : -80 + (i + 1) * 8);
  // Zone boundary longitudes for one latitude band.
  const boundaries = (i) => {
    const letter = UTM_BANDS[i];
    const lons = [];
    for (let z = 0; z <= 60; z++) lons.push(-180 + z * 6);
    if (letter === 'V') return lons.map((l) => (l === 6 ? 3 : l));
    if (letter === 'X')
      return lons
        .filter((l) => ![6, 18, 30].includes(l))
        .map((l) => (l === 12 ? 9 : l === 24 ? 21 : l === 36 ? 33 : l));
    return lons;
  };
  for (let i = 0; i < UTM_BANDS.length; i++) {
    const s = bandSouth(i);
    const n = bandNorth(i);
    for (const lon of boundaries(i)) {
      if (lon >= 180) continue;
      features.push(
        line(
          [
            [
              [lon, s],
              [lon, (s + n) / 2],
              [lon, n],
            ],
          ],
          { name: 'UTM zone boundary' },
        ),
      );
    }
    const coords = [];
    for (let lon = -180; lon <= 180; lon += 2) coords.push([lon, s]);
    features.push(line([coords], { name: `UTM band ${UTM_BANDS[i]}` }));
    // Labels at zone centers.
    const lons = boundaries(i);
    for (let k = 0; k < lons.length - 1; k++) {
      const west = lons[k];
      const east = lons[k + 1];
      const center = (west + east) / 2;
      const zone = Math.floor((center + 180) / 6) + 1;
      features.push(
        point(center, (s + n) / 2, {
          name: `${zone}${UTM_BANDS[i]}`,
          label: true,
        }),
      );
    }
  }
  const top = [];
  for (let lon = -180; lon <= 180; lon += 2) top.push([lon, 84]);
  features.push(line([top], { name: 'UTM northern limit (84°N)' }));
  return features;
}

/** Maidenhead field (20° × 10°) grid with AA…RR labels. */
export function maidenheadFeatures() {
  const features = [];
  for (let lon = -180; lon < 180; lon += 20)
    features.push(meridian(lon, 'Maidenhead field', -90, 90));
  for (let lat = -80; lat < 90; lat += 10)
    features.push(parallel(lat, 'Maidenhead field'));
  for (let i = 0; i < 18; i++)
    for (let j = 0; j < 18; j++)
      features.push(
        point(-170 + i * 20, -85 + j * 10, {
          name: `${String.fromCharCode(65 + i)}${String.fromCharCode(65 + j)}`,
          label: true,
        }),
      );
  return features;
}

/** Maidenhead locator (6 characters) for a point — shown in info cards. */
export function maidenheadLocator(lat, lon) {
  const L = normalizeLon(lon) + 180;
  const A = Math.max(0, Math.min(179.9999, lat + 90));
  const f1 = Math.floor(L / 20);
  const f2 = Math.floor(A / 10);
  const s1 = Math.floor((L % 20) / 2);
  const s2 = Math.floor(A % 10);
  const u1 = Math.floor(((L % 2) * 60) / 5);
  const u2 = Math.floor(((A % 1) * 60) / 2.5);
  return (
    String.fromCharCode(65 + f1) +
    String.fromCharCode(65 + f2) +
    s1 +
    s2 +
    String.fromCharCode(97 + u1) +
    String.fromCharCode(97 + u2)
  );
}

/** Nominal time-zone meridians every 15° (boundaries at ±7.5°) with UTC labels. */
export function timeMeridianFeatures() {
  const features = [];
  for (let k = -12; k <= 12; k++) {
    const boundary = k * 15 + 7.5;
    if (boundary < 180)
      features.push(meridian(boundary, 'Nominal zone boundary'));
    const label = k === 0 ? 'UTC' : `UTC${k > 0 ? '+' : '−'}${Math.abs(k)}`;
    features.push(
      point(k === 12 ? 176 : k === -12 ? -176 : k * 15, 0, {
        name: label,
        label: true,
      }),
    );
  }
  return features;
}

/** Range rings (km) around a center point. */
export function rangeRingFeatures(
  lat,
  lon,
  radiiKm = [10, 50, 100, 250, 500, 1000],
) {
  const features = radiiKm.map((km) =>
    line(smallCircle(lat, lon, ((km * 1000) / EARTH_RADIUS_M) * DEG, 128), {
      name: `${km} km`,
    }),
  );
  for (const km of radiiKm) {
    const [x, y] = destination(
      lat,
      lon,
      0,
      ((km * 1000) / EARTH_RADIUS_M) * DEG,
    );
    features.push(point(x, y, { name: `${km} km`, label: true }));
  }
  return features;
}

/** Geometric horizon distance (m) for an eye height above the sphere. */
export function horizonDistanceM(heightM) {
  const h = Math.max(0, Number(heightM) || 0);
  return Math.sqrt(h * (2 * EARTH_RADIUS_M + h));
}

/** Horizon circle (surface arc) around the camera nadir. */
export function horizonFeature(lat, lon, heightM) {
  const angular =
    Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + Math.max(1, heightM))) * DEG;
  const km = Math.round((angular * RAD * EARTH_RADIUS_M) / 1000);
  return line(smallCircle(lat, lon, Math.min(angular, 89.5), 180), {
    name: `Horizon · ${km.toLocaleString('en-US')} km`,
    distance_km: km,
  });
}

/** The antipode of a point. */
export function antipodeFeature(lat, lon) {
  const alat = -lat;
  const alon = normalizeLon(lon + 180);
  return point(alon, alat, {
    name: `Antipode ${Math.abs(alat).toFixed(2)}°${alat < 0 ? 'S' : 'N'} ${Math.abs(alon).toFixed(2)}°${alon < 0 ? 'W' : 'E'}`,
  });
}

/** Great-circle lines from a center toward the 8 compass bearings. */
export function compassLineFeatures(lat, lon, lengthKm = 10000) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const angular = ((lengthKm * 1000) / EARTH_RADIUS_M) * DEG;
  return names.map((name, i) => {
    const pts = [];
    for (let s = 0; s <= 100; s++)
      pts.push(destination(lat, lon, i * 45, (s / 100) * angular));
    return line(splitAtAntimeridian(pts), { name: `${name} great circle` });
  });
}

/** Ground track of a moving sub-point over the next `hours`. */
export function subpointTrack(fn, date = new Date(), hours = 24, stepMin = 15) {
  const pts = [];
  for (let m = 0; m <= hours * 60; m += stepMin) {
    const p = fn(new Date(date.valueOf() + m * 60_000));
    pts.push([p.lon, p.lat]);
  }
  return splitAtAntimeridian(pts);
}

/** Sun position point + 24 h track. */
export function subsolarFeatures(date = new Date()) {
  const sun = subsolarPoint(date);
  return [
    point(sun.lon, sun.lat, {
      name: `☀ Sun overhead · ${sun.lat.toFixed(1)}°, ${sun.lon.toFixed(1)}°`,
      declination: sun.declination,
    }),
    line(subpointTrack(subsolarPoint, date), { name: 'Sun track (next 24 h)' }),
  ];
}

/** Moon position point (with phase) + 24 h track. */
export function sublunarFeatures(date = new Date()) {
  const moon = sublunarPoint(date);
  const lit = Math.round(moon.fraction * 100);
  return [
    point(moon.lon, moon.lat, {
      name: `☾ ${moonPhaseName(moon.phase, moon.fraction)} · ${lit}% lit`,
      distance_km: Math.round(moon.distanceKm),
      illumination: lit,
    }),
    line(subpointTrack(sublunarPoint, date), {
      name: 'Moon track (next 24 h)',
    }),
  ];
}

/**
 * Rasterize a solar-elevation band into RGBA pixels on an equirectangular
 * grid (row 0 = 90°N). `shade(elevationDeg)` returns [r,g,b,a] 0..255 or null.
 */
export function rasterizeSolar(width, height, date, shade) {
  const sun = subsolarPoint(date);
  const data = new Uint8ClampedArray(width * height * 4);
  const sinDec = Math.sin(sun.lat * RAD);
  const cosDec = Math.cos(sun.lat * RAD);
  const cosH = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const lon = -180 + ((x + 0.5) / width) * 360;
    cosH[x] = Math.cos((lon - sun.lon) * RAD);
  }
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) / height) * 180;
    const sp = Math.sin(lat * RAD);
    const cp = Math.cos(lat * RAD);
    for (let x = 0; x < width; x++) {
      const elev = Math.asin(sp * sinDec + cp * cosDec * cosH[x]) * DEG;
      const c = shade(elev);
      if (!c) continue;
      const o = (y * width + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = c[3];
    }
  }
  return data;
}

/** Night shading: transparent in daylight, deepening through twilight. */
export function nightShade(elev) {
  if (elev >= 0) return null;
  const t = Math.min(1, -elev / 18);
  return [6, 12, 34, Math.round(70 + 120 * t)];
}

/** Golden (sun 0–6° up) and blue (0–4° down) hour band. */
export function goldenHourShade(elev) {
  if (elev > 6 || elev < -4) return null;
  return elev >= 0 ? [255, 176, 32, 110] : [60, 110, 255, 95];
}
