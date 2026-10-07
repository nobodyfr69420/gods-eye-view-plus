/**
 * @module satelliteGroups/model
 * @description Category table and Cesium-free orbit geometry for the Satellite
 * Groups layer (and the crewed-station and re-entry layers that reuse it).
 *
 * Categories map onto public CelesTrak GP groups
 * (https://celestrak.org/NORAD/elements/). A satellite listed in several
 * groups keeps the FIRST category in `SATELLITE_GROUP_CATEGORIES` order, so
 * the specific bucket (a station, a debris field) beats the broad one.
 *
 * Orbit figures here are derived from TLE mean elements. They are good to a
 * few kilometres for display; they are not precision ephemerides.
 */

/** WGS-84 equatorial radius, km. */
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
/** Mean Earth radius used for spherical footprint geometry, km. */
export const EARTH_MEAN_RADIUS_KM = 6371.0088;
/** Earth gravitational parameter, km³/s². */
export const EARTH_MU_KM3_S2 = 398600.4418;

/**
 * Display categories. `groups` are CelesTrak GROUP names served through the
 * existing `/api/celestrak/<group>` cache. `defaultOn` categories load when the
 * layer is first enabled; the large shells (Starlink, debris) are opt-in.
 */
export const SATELLITE_GROUP_CATEGORIES = Object.freeze([
  {
    id: 'stations',
    label: 'Stations',
    chip: 'STATIONS',
    groups: ['stations'],
    color: '#fff6e5',
    defaultOn: false,
    blurb: 'Crewed stations and docked/visiting vehicles',
  },
  {
    id: 'debris',
    label: 'Debris fields',
    chip: 'DEBRIS',
    groups: [
      'cosmos-1408-debris',
      'fengyun-1c-debris',
      'iridium-33-debris',
      'cosmos-2251-debris',
    ],
    color: '#d9776b',
    defaultOn: false,
    blurb:
      'Tracked fragments of the Cosmos 1408 and Fengyun-1C ASAT tests and the Iridium 33 / Cosmos 2251 collision',
  },
  {
    id: 'gnss',
    label: 'GNSS',
    chip: 'GNSS',
    groups: ['gnss'],
    color: '#4fd8ff',
    defaultOn: true,
    blurb: 'Navigation: GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC',
  },
  {
    id: 'weather',
    label: 'Weather',
    chip: 'WEATHER',
    groups: ['weather'],
    color: '#8fe3b0',
    defaultOn: true,
    blurb: 'Meteorological satellites (NOAA, GOES, Meteosat, Himawari, FY…)',
  },
  {
    id: 'earth',
    label: 'Earth observation',
    chip: 'EARTH OBS',
    groups: ['resource', 'planet', 'spire'],
    color: '#9ad46f',
    defaultOn: false,
    blurb: 'Earth resources, Planet and Spire constellations',
  },
  {
    id: 'science',
    label: 'Science',
    chip: 'SCIENCE',
    groups: ['science', 'geodetic'],
    color: '#d6f07a',
    defaultOn: true,
    blurb: 'Space science and geodetic satellites',
  },
  {
    id: 'amateur',
    label: 'Amateur radio',
    chip: 'AMATEUR',
    groups: ['amateur'],
    color: '#ff9ad5',
    defaultOn: true,
    blurb: 'Amateur-radio satellites',
  },
  {
    id: 'military',
    label: 'Military (public catalog)',
    chip: 'MILITARY',
    groups: ['military'],
    color: '#e8b04a',
    defaultOn: true,
    blurb:
      'CelesTrak "miscellaneous military" — only objects in the public catalog; classified objects are absent',
  },
  {
    id: 'starlink',
    label: 'Starlink',
    chip: 'STARLINK',
    groups: ['starlink'],
    color: '#54697f',
    defaultOn: false,
    heavy: true,
    blurb: 'SpaceX Starlink broadband shell (thousands of points)',
  },
  {
    id: 'oneweb',
    label: 'OneWeb',
    chip: 'ONEWEB',
    groups: ['oneweb'],
    color: '#6f86a8',
    defaultOn: false,
    blurb: 'Eutelsat OneWeb broadband constellation',
  },
  {
    id: 'kuiper',
    label: 'Kuiper',
    chip: 'KUIPER',
    groups: ['kuiper'],
    color: '#8a7fb8',
    defaultOn: false,
    blurb: 'Amazon Project Kuiper',
  },
  {
    id: 'china-broadband',
    label: 'Qianfan / Guowang',
    chip: 'QIANFAN/GW',
    groups: ['qianfan', 'hulianwang'],
    color: '#b87f9a',
    defaultOn: false,
    blurb: 'Chinese broadband constellations (Qianfan, Hulianwang/Guowang)',
  },
  {
    id: 'comms',
    label: 'Other comms',
    chip: 'COMMS',
    groups: ['iridium-NEXT', 'orbcomm', 'globalstar', 'intelsat', 'ses'],
    color: '#7b93ad',
    defaultOn: false,
    blurb: 'Iridium NEXT, Orbcomm, Globalstar, Intelsat and SES',
  },
  {
    id: 'geo',
    label: 'GEO belt',
    chip: 'GEO',
    groups: ['geo'],
    color: '#c89bff',
    defaultOn: false,
    blurb: 'Active geosynchronous satellites',
  },
  {
    id: 'cubesat',
    label: 'CubeSats',
    chip: 'CUBESAT',
    groups: ['cubesat'],
    color: '#f0d27a',
    defaultOn: false,
    blurb: 'CubeSats',
  },
  {
    id: 'recent',
    label: 'Launched last 30 days',
    chip: 'LAST 30 D',
    groups: ['last-30-days'],
    color: '#ffffff',
    defaultOn: false,
    blurb: 'Objects catalogued from launches in the last 30 days',
  },
]);

export const SATELLITE_GROUP_CATEGORY_IDS = Object.freeze(
  SATELLITE_GROUP_CATEGORIES.map((category) => category.id),
);

const CATEGORY_BY_ID = new Map(
  SATELLITE_GROUP_CATEGORIES.map((category) => [category.id, category]),
);

/** Every CelesTrak group any category reads. */
export const SATELLITE_GROUP_NAMES = Object.freeze([
  ...new Set(SATELLITE_GROUP_CATEGORIES.flatMap((category) => category.groups)),
]);

/** @param {string} id @returns {object|null} */
export function satelliteGroupCategory(id) {
  return CATEGORY_BY_ID.get(id) || null;
}

/** Category ids enabled on first use. */
export function defaultSatelliteGroupCategories() {
  return SATELLITE_GROUP_CATEGORIES.filter((c) => c.defaultOn).map((c) => c.id);
}

/**
 * Normalize a requested category list: known ids only, in table order.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeSatelliteGroupCategories(value) {
  if (!Array.isArray(value)) return defaultSatelliteGroupCategories();
  const requested = new Set(value.map(String));
  return SATELLITE_GROUP_CATEGORY_IDS.filter((id) => requested.has(id));
}

function field(line, start, end) {
  return String(line || '')
    .slice(start, end)
    .trim();
}

/** Parse a TLE "assumed decimal" exponent field such as ` 12345-3`. */
export function tleExponentField(raw) {
  const text = String(raw || '').trim();
  const match = /^([+-]?)(\d{1,5})([+-]\d)$/.exec(text);
  if (!match) return Number.isFinite(Number(text)) ? Number(text) : null;
  const mantissa = Number(`0.${match[2]}`) * (match[1] === '-' ? -1 : 1);
  return mantissa * 10 ** Number(match[3]);
}

/**
 * TLE epoch to epoch milliseconds (two-digit years: 57–99 → 19xx).
 * @param {string} line1
 * @returns {number|null}
 */
export function tleEpochMs(line1) {
  const raw = field(line1, 18, 32);
  const match = /^(\d{2})(\d{3}\.\d+)$/.exec(raw);
  if (!match) return null;
  const yy = Number(match[1]);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const dayOfYear = Number(match[2]);
  if (!(dayOfYear >= 1 && dayOfYear < 367)) return null;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000;
}

/**
 * Mean-element orbit summary from a TLE pair.
 * @param {string} line1
 * @param {string} line2
 * @returns {{norad:number, epochMs:number|null, inclinationDeg:number, eccentricity:number, meanMotion:number, periodMin:number, semiMajorKm:number, perigeeKm:number, apogeeKm:number, ndot:number|null, bstar:number|null, regime:string}|null}
 */
export function tleOrbitSummary(line1, line2) {
  if (!/^1 /.test(String(line1)) || !/^2 /.test(String(line2))) return null;
  const norad = Number.parseInt(field(line1, 2, 7), 10);
  const inclinationDeg = Number(field(line2, 8, 16));
  const eccentricity = Number(`0.${field(line2, 26, 33)}`);
  const meanMotion = Number(field(line2, 52, 63));
  if (
    !Number.isInteger(norad) ||
    !Number.isFinite(inclinationDeg) ||
    !Number.isFinite(eccentricity) ||
    !(meanMotion > 0.05 && meanMotion < 20)
  )
    return null;
  const shape = orbitShape(meanMotion, eccentricity);
  return {
    norad,
    epochMs: tleEpochMs(line1),
    inclinationDeg,
    eccentricity,
    meanMotion,
    ...shape,
    ndot: Number.isFinite(Number(field(line1, 33, 43)))
      ? Number(field(line1, 33, 43))
      : null,
    bstar: tleExponentField(field(line1, 53, 61)),
    regime: orbitRegime({ ...shape, eccentricity }),
  };
}

/**
 * Semi-major axis, period, perigee and apogee heights from mean motion.
 * @param {number} meanMotion Revolutions per day.
 * @param {number} eccentricity
 */
export function orbitShape(meanMotion, eccentricity) {
  const n = (meanMotion * 2 * Math.PI) / 86_400; // rad/s
  const semiMajorKm = Math.cbrt(EARTH_MU_KM3_S2 / (n * n));
  return {
    periodMin: 1440 / meanMotion,
    semiMajorKm,
    perigeeKm: semiMajorKm * (1 - eccentricity) - EARTH_EQUATORIAL_RADIUS_KM,
    apogeeKm: semiMajorKm * (1 + eccentricity) - EARTH_EQUATORIAL_RADIUS_KM,
  };
}

/**
 * Coarse orbit regime label.
 * @returns {'LEO'|'MEO'|'GEO'|'HEO'}
 */
export function orbitRegime({ periodMin, apogeeKm, eccentricity }) {
  if (eccentricity >= 0.25) return 'HEO';
  if (periodMin >= 1400 && periodMin <= 1480 && eccentricity < 0.05)
    return 'GEO';
  if (apogeeKm < 2000) return 'LEO';
  return 'MEO';
}

/**
 * Radius of a satellite's coverage footprint on a spherical Earth: the ground
 * distance from the sub-satellite point to where the satellite sits at
 * `minElevationDeg` above the horizon.
 * @param {number} altitudeKm Height above the surface.
 * @param {number} [minElevationDeg=0] Elevation mask.
 * @returns {number} Great-circle radius in km (0 when undefined).
 */
export function footprintRadiusKm(altitudeKm, minElevationDeg = 0) {
  if (!(altitudeKm > 0) || !Number.isFinite(minElevationDeg)) return 0;
  const R = EARTH_MEAN_RADIUS_KM;
  const eps = (Math.max(0, Math.min(89, minElevationDeg)) * Math.PI) / 180;
  const lambda = Math.acos((R / (R + altitudeKm)) * Math.cos(eps)) - eps;
  return lambda > 0 ? R * lambda : 0;
}

/**
 * Point at a great-circle distance and initial bearing from a start point.
 * @returns {{latitude:number, longitude:number}}
 */
export function destinationPoint(latDeg, lonDeg, bearingDeg, distanceKm) {
  const d = distanceKm / EARTH_MEAN_RADIUS_KM;
  const lat1 = (latDeg * Math.PI) / 180;
  const lon1 = (lonDeg * Math.PI) / 180;
  const brg = (bearingDeg * Math.PI) / 180;
  const sinLat2 =
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/**
 * Closed ring of surface points around a sub-satellite point.
 * @returns {Array<{latitude:number, longitude:number}>}
 */
export function footprintRing(latDeg, lonDeg, radiusKm, segments = 96) {
  if (!(radiusKm > 0)) return [];
  const ring = [];
  for (let i = 0; i <= segments; i++)
    ring.push(destinationPoint(latDeg, lonDeg, (360 * i) / segments, radiusKm));
  return ring;
}

/**
 * Great-circle distance between two points, km.
 */
export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Sample times for a ground track centred on `centerMs`.
 * @param {number} centerMs
 * @param {number} periodMin Orbital period.
 * @param {{before?: number, after?: number, maxSamples?: number}} [options]
 *   Orbits to draw before/after now.
 * @returns {number[]}
 */
export function groundTrackSampleTimes(
  centerMs,
  periodMin,
  { before = 0.5, after = 1, maxSamples = 360 } = {},
) {
  if (!Number.isFinite(centerMs) || !(periodMin > 0)) return [];
  // GEO and slower orbits barely move over the ground in one period; cap the
  // drawn span at one day.
  const spanMin = Math.min(periodMin, 1440);
  const startMs = centerMs - before * spanMin * 60_000;
  const endMs = centerMs + after * spanMin * 60_000;
  const samples = Math.max(
    16,
    Math.min(maxSamples, Math.ceil((endMs - startMs) / 30_000)),
  );
  const step = (endMs - startMs) / samples;
  const times = [];
  for (let i = 0; i <= samples; i++) times.push(startMs + i * step);
  return times;
}

/** Age label for a TLE epoch. */
export function tleAgeLabel(epochMs, nowMs = Date.now()) {
  if (!Number.isFinite(epochMs)) return 'epoch unknown';
  const hours = (nowMs - epochMs) / 3_600_000;
  if (hours < 0) return 'epoch in the future';
  if (hours < 48) return `TLE ${Math.round(hours)} h old`;
  return `TLE ${Math.round(hours / 24)} d old`;
}
