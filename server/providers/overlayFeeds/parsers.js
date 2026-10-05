/**
 * Pure normalizers for the Overlay Library feed proxy. Every function takes an
 * upstream body (already parsed JSON or text) and returns plain GeoJSON-like
 * features `{ type:'Feature', geometry, properties }` with only the fields the
 * browser draws or shows, coordinates rounded to 5 decimals (~1 m), and every
 * value bounded. Nothing here touches the network, the filesystem or Cesium.
 */

const MAX_TEXT = 160;

/** Bounded, control-character-free text or null. */
export function cleanText(value, max = MAX_TEXT) {
  if (value === null || value === undefined) return null;
  const text = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text === 'null' || text === 'undefined') return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Finite number within [min, max] or null. Accepts numeric strings. */
export function cleanNumber(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Only http(s) links survive; everything else becomes null. */
export function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const round = (n) => Math.round(n * 1e5) / 1e5;

function validLonLat(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/** A point feature, or null when the coordinates are not usable. */
export function pointFeature(lon, lat, properties) {
  let x = cleanNumber(lon);
  const y = cleanNumber(lat);
  if (x !== null && x > 180 && x <= 360) x -= 360;
  if (!validLonLat(x, y)) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round(x), round(y)] },
    properties,
  };
}

function roundPositions(coords, depth) {
  if (depth === 0) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const x = Number(coords[0]);
    const y = Number(coords[1]);
    return validLonLat(x, y) ? [round(x), round(y)] : null;
  }
  if (!Array.isArray(coords)) return null;
  const out = [];
  for (const item of coords) {
    const next = roundPositions(item, depth - 1);
    if (next) out.push(next);
  }
  return out;
}

const DEPTH = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

/** Round and validate a GeoJSON geometry; drop empty or unsupported ones. */
export function cleanGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (geometry.type === 'GeometryCollection') {
    const first = (geometry.geometries || []).map(cleanGeometry).find(Boolean);
    return first || null;
  }
  const depth = DEPTH[geometry.type];
  if (depth === undefined) return null;
  const coordinates = roundPositions(geometry.coordinates, depth);
  if (!coordinates || (Array.isArray(coordinates) && !coordinates.length))
    return null;
  if (geometry.type === 'LineString' && coordinates.length < 2) return null;
  if (geometry.type === 'Polygon' && !(coordinates[0]?.length >= 4))
    return null;
  return { type: geometry.type, coordinates };
}

/** Read a property regardless of the upstream's key casing. */
export function prop(properties, key) {
  if (!properties) return undefined;
  if (key in properties) return properties[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(properties))
    if (k.toLowerCase() === lower) return properties[k];
  return undefined;
}

/**
 * Generic GeoJSON slimmer: keep `pick` properties (renamed via `[from, to]`
 * pairs), validate geometry, optional feature filter.
 */
export function slimGeojson(
  body,
  { pick = [], filter = null, limit = 60000 } = {},
) {
  const features = Array.isArray(body?.features) ? body.features : [];
  const out = [];
  for (const feature of features) {
    if (out.length >= limit) break;
    const p = feature?.properties || {};
    if (filter && !filter(p, feature)) continue;
    const geometry = cleanGeometry(feature?.geometry);
    if (!geometry) continue;
    const properties = {};
    for (const entry of pick) {
      const [from, to, kind] = Array.isArray(entry) ? entry : [entry, entry];
      const raw = prop(p, from);
      const value =
        kind === 'number'
          ? cleanNumber(raw)
          : kind === 'url'
            ? cleanUrl(raw)
            : typeof raw === 'number'
              ? cleanNumber(raw)
              : cleanText(raw);
      if (value !== null && value !== undefined) properties[to] = value;
    }
    out.push({ type: 'Feature', geometry, properties });
  }
  return out;
}

/** Small RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text, { maxRows = 200000 } = {}) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (rows.length > maxRows) break;
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = r[i] ?? '';
    return o;
  });
}

// ── Source-specific normalizers ───────────────────────────────────────────

/** NASA EONET v3 GeoJSON (points, sometimes polygons). */
export function eonetFeatures(body) {
  return slimGeojson(body, {
    pick: [
      'title',
      'date',
      ['magnitudeValue', 'magnitude', 'number'],
      ['magnitudeUnit', 'unit'],
      ['link', 'link', 'url'],
    ],
  }).map((feature, index) => {
    const source = body.features?.[index]?.properties?.sources?.[0]?.url;
    if (source && cleanUrl(source))
      feature.properties.source = cleanUrl(source);
    return feature;
  });
}

const GDACS_TYPES = new Set(['EQ', 'TC', 'FL', 'VO', 'DR', 'WF']);

/** GDACS event list(s) → point features keyed by type + id (deduplicated). */
export function gdacsFeatures(bodies, type) {
  const seen = new Set();
  const out = [];
  for (const body of bodies) {
    for (const feature of body?.features || []) {
      const p = feature?.properties || {};
      if (!GDACS_TYPES.has(p.eventtype) || (type && p.eventtype !== type))
        continue;
      const key = `${p.eventtype}:${p.eventid}`;
      if (seen.has(key)) continue;
      const geometry = cleanGeometry(feature.geometry);
      if (!geometry || geometry.type !== 'Point') continue;
      seen.add(key);
      out.push({
        type: 'Feature',
        geometry,
        properties: {
          name: cleanText(p.name || p.eventname),
          type: p.eventtype,
          alert: cleanText(p.alertlevel, 16),
          score: cleanNumber(p.alertscore),
          country: cleanText(p.country),
          from: cleanText(p.fromdate, 32),
          to: cleanText(p.todate, 32),
          severity: cleanText(p.severitydata?.severitytext),
          link: cleanUrl(p.url?.report),
        },
      });
    }
  }
  return out;
}

/** NWS active alerts (storm-based polygons only) filtered by event group. */
export function nwsAlertFeatures(body, matcher) {
  return slimGeojson(body, {
    filter: (p) => matcher(String(p.event || '')),
    pick: [
      'event',
      'severity',
      'urgency',
      'headline',
      ['areaDesc', 'area'],
      'expires',
      ['senderName', 'sender'],
    ],
  });
}

/** NWS event-name groups used to split one alert feed into overlays. */
export const NWS_GROUPS = Object.freeze({
  tornado: (e) => /tornado/i.test(e),
  'severe-thunderstorm': (e) => /severe thunderstorm/i.test(e),
  flood: (e) => /flood/i.test(e) && !/coastal|lakeshore/i.test(e),
  coastal: (e) =>
    /coastal|lakeshore|rip current|high surf|storm surge|tsunami/i.test(e),
  winter: (e) =>
    /winter|blizzard|ice storm|freez|snow|frost|wind chill|cold/i.test(e),
  heat: (e) => /heat/i.test(e),
  fire: (e) => /red flag|fire weather|fire warning/i.test(e),
  wind: (e) => /\bwind\b|dust|extreme wind/i.test(e) && !/chill/i.test(e),
  marine: (e) =>
    /marine|small craft|gale|hurricane force|storm warning|special marine|low water|brisk/i.test(
      e,
    ),
  tropical: (e) =>
    /hurricane|tropical|typhoon/i.test(e) && !/force wind/i.test(e),
  all: () => true,
});

/** SPC outlook polygons with their published colors and labels. */
export function spcFeatures(body) {
  return slimGeojson(body, {
    pick: ['LABEL', 'LABEL2', 'fill', 'stroke', 'VALID', 'EXPIRE', 'ISSUE'],
  }).map((feature) => {
    const p = feature.properties;
    return {
      ...feature,
      properties: {
        label: p.LABEL ?? null,
        name: p.LABEL2 ?? p.LABEL ?? null,
        fill: /^#[0-9a-f]{6}$/i.test(p.fill || '') ? p.fill : null,
        stroke: /^#[0-9a-f]{6}$/i.test(p.stroke || '') ? p.stroke : null,
        valid: p.VALID ?? null,
        expires: p.EXPIRE ?? null,
      },
    };
  });
}

/** sensor.community dust sensors → points with PM2.5/PM10 (µg/m³). */
export function sensorCommunityFeatures(body, { kind = 'dust' } = {}) {
  const rows = Array.isArray(body) ? body : [];
  const bySensorLocation = new Map();
  for (const row of rows) {
    const loc = row?.location;
    if (!loc || Number(loc.indoor) === 1) continue;
    const values = {};
    for (const v of row.sensordatavalues || []) values[v.value_type] = v.value;
    const props =
      kind === 'temperature'
        ? {
            temp: cleanNumber(values.temperature, -60, 70),
            humidity: cleanNumber(values.humidity, 0, 100),
          }
        : {
            pm25: cleanNumber(values.P2, 0, 2000),
            pm10: cleanNumber(values.P1, 0, 2000),
          };
    if (
      kind === 'temperature'
        ? props.temp === null
        : props.pm25 === null && props.pm10 === null
    )
      continue;
    const feature = pointFeature(loc.longitude, loc.latitude, {
      id: cleanText(row.sensor?.id, 16),
      country: cleanText(loc.country, 4),
      time: cleanText(row.timestamp, 24),
      ...props,
    });
    if (!feature) continue;
    // One feature per location: newest row wins.
    bySensorLocation.set(`${loc.id}`, feature);
  }
  return [...bySensorLocation.values()];
}

/** NDBC latest_obs.txt fixed-width table → buoy/station points. */
export function ndbcFeatures(text) {
  const lines = String(text).split(/\r?\n/);
  const header = (lines.find((l) => l.startsWith('#STN')) || '')
    .replace(/^#/, '')
    .trim()
    .split(/\s+/);
  if (!header.length || header[0] !== 'STN') return [];
  const idx = (name) => header.indexOf(name);
  const num = (cols, name, min, max) => {
    const i = idx(name);
    const v = i >= 0 ? cols[i] : null;
    return v === 'MM' ? null : cleanNumber(v, min, max);
  };
  const out = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) continue;
    const time = ['YYYY', 'MM', 'DD', 'hh', 'mm'].map((k) => cols[idx(k)]);
    const feature = pointFeature(cols[idx('LON')], cols[idx('LAT')], {
      name: cleanText(cols[0], 12),
      time: time.every((t) => /^\d+$/.test(t || ''))
        ? `${time[0]}-${time[1]}-${time[2]}T${time[3]}:${time[4]}Z`
        : null,
      wind_dir: num(cols, 'WDIR', 0, 360),
      wind_ms: num(cols, 'WSPD', 0, 100),
      gust_ms: num(cols, 'GST', 0, 150),
      wave_m: num(cols, 'WVHT', 0, 40),
      period_s: num(cols, 'DPD', 0, 40),
      pressure: num(cols, 'PRES', 800, 1100),
      air_c: num(cols, 'ATMP', -60, 60),
      water_c: num(cols, 'WTMP', -5, 40),
    });
    if (feature) out.push(feature);
  }
  return out;
}

/** NOAA CO-OPS water-level station metadata. */
export function coopsFeatures(body) {
  return (body?.stations || [])
    .map((s) =>
      pointFeature(s.lng, s.lat, {
        name: cleanText(s.name),
        id: cleanText(s.id, 12),
        state: cleanText(s.state, 8),
        link: s.id
          ? `https://tidesandcurrents.noaa.gov/stationhome.html?id=${encodeURIComponent(String(s.id).slice(0, 12))}`
          : null,
      }),
    )
    .filter(Boolean);
}

/** SWPC OVATION aurora grid → points where probability ≥ threshold. */
export function auroraFeatures(body, threshold = 8) {
  const out = [];
  for (const c of body?.coordinates || []) {
    if (!Array.isArray(c) || c.length < 3) continue;
    const p = cleanNumber(c[2], 0, 100);
    if (p === null || p < threshold) continue;
    const feature = pointFeature(c[0], c[1], { probability: p });
    if (feature) out.push(feature);
  }
  return out;
}

/** USGS HANS elevated-volcano notices. */
export function usgsVolcanoFeatures(body) {
  return (Array.isArray(body) ? body : [])
    .map((v) =>
      pointFeature(v.long ?? v.lng ?? v.longitude, v.lat ?? v.latitude, {
        name: cleanText(v.vName),
        alert: cleanText(v.alertLevel, 24),
        color: cleanText(v.colorCode, 12),
        observatory: cleanText(v.obs, 12)?.toUpperCase() ?? null,
        sent: cleanText(v.sentUtc, 32),
        synopsis: cleanText(v.noticeSynopsis, 240),
        link: cleanUrl(v.noticeUrl),
      }),
    )
    .filter(Boolean);
}

/** NOAA NWPS gauges → only gauges at or above action stage. */
export function nwpsFloodFeatures(body) {
  const ORDER = { action: 1, minor: 2, moderate: 3, major: 4 };
  const out = [];
  for (const g of body?.gauges || []) {
    const observed = g?.status?.observed?.floodCategory;
    const forecast = g?.status?.forecast?.floodCategory;
    const level = Math.max(ORDER[observed] || 0, ORDER[forecast] || 0);
    if (!level) continue;
    const category = Object.keys(ORDER).find((k) => ORDER[k] === level);
    const feature = pointFeature(g.longitude, g.latitude, {
      name: cleanText(g.name),
      id: cleanText(g.lid, 12),
      category,
      observed: cleanText(observed, 24),
      forecast: cleanText(forecast, 24),
      stage: cleanNumber(g?.status?.observed?.primary, -1000, 100000),
      unit: cleanText(g?.status?.observed?.primaryUnit, 8),
      state: cleanText(g?.state?.abbreviation, 4),
      link: g.lid
        ? `https://water.noaa.gov/gauges/${encodeURIComponent(String(g.lid).slice(0, 12).toLowerCase())}`
        : null,
    });
    if (feature) out.push(feature);
  }
  return out;
}

/** NCEI HazEL paged items → points (tsunamis, earthquakes, eruptions). */
export function hazelFeatures(pages, kind) {
  const out = [];
  const seen = new Set();
  for (const page of pages) {
    for (const item of page?.items || []) {
      // Pages may overlap if the service ignores `page`; keep each event once.
      const key =
        item?.id ??
        `${item?.year}-${item?.month}-${item?.day}-${item?.latitude}-${item?.longitude}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const date = [item.year, item.month, item.day]
        .filter((v) => v !== null && v !== undefined)
        .join('-');
      const base = {
        year: cleanNumber(item.year, -10000, 3000),
        date: cleanText(date, 16),
        country: cleanText(item.country, 60),
        deaths: cleanNumber(item.deathsTotal ?? item.deaths, 0, 1e7),
      };
      const props =
        kind === 'tsunamis'
          ? {
              ...base,
              name: cleanText(item.locationName) || 'Tsunami',
              magnitude: cleanNumber(item.eqMagnitude, 0, 10),
              max_water_m: cleanNumber(item.maxWaterHeight, 0, 600),
              runups: cleanNumber(item.numRunups, 0, 100000),
            }
          : kind === 'volcanoes'
            ? {
                ...base,
                name: cleanText(item.name) || 'Eruption',
                vei: cleanNumber(item.vei, 0, 8),
                elevation: cleanNumber(item.elevation, -6000, 9000),
                type: cleanText(item.morphology, 40),
              }
            : {
                ...base,
                name: cleanText(item.locationName) || 'Earthquake',
                magnitude: cleanNumber(item.eqMagnitude ?? item.eqMagMw, 0, 10),
                depth_km: cleanNumber(item.eqDepth, 0, 800),
                damage_musd: cleanNumber(
                  item.damageMillionsDollars ?? item.damageMillionsDollarsTotal,
                  0,
                  1e7,
                ),
              };
      const feature = pointFeature(item.longitude, item.latitude, props);
      if (feature) out.push(feature);
    }
  }
  return out;
}

/** WRI Global Power Plant Database CSV rows → points for one fuel group. */
export function powerPlantFeatures(rows, fuels) {
  const wanted = new Set(fuels.map((f) => f.toLowerCase()));
  const out = [];
  for (const r of rows) {
    if (!wanted.has(String(r.primary_fuel || '').toLowerCase())) continue;
    const feature = pointFeature(r.longitude, r.latitude, {
      name: cleanText(r.name),
      country: cleanText(r.country_long, 60),
      fuel: cleanText(r.primary_fuel, 24),
      capacity_mw: cleanNumber(r.capacity_mw, 0, 30000),
      year: cleanNumber(r.commissioning_year, 1800, 2100),
      owner: cleanText(r.owner, 80),
    });
    if (feature) out.push(feature);
  }
  return out;
}

/** OurAirports airports.csv rows → points for the requested types. */
export function airportFeatures(rows, types) {
  const wanted = new Set(types);
  const out = [];
  for (const r of rows) {
    if (!wanted.has(r.type)) continue;
    const feature = pointFeature(r.longitude_deg, r.latitude_deg, {
      name: cleanText(r.name),
      ident: cleanText(r.icao_code || r.gps_code || r.ident, 8),
      iata: cleanText(r.iata_code, 4),
      type: r.type,
      city: cleanText(r.municipality, 60),
      country: cleanText(r.iso_country, 4),
      elevation_ft: cleanNumber(r.elevation_ft, -2000, 20000),
      scheduled: r.scheduled_service === 'yes' ? 'yes' : null,
      link: cleanUrl(r.wikipedia_link) || cleanUrl(r.home_link),
    });
    if (feature) out.push(feature);
  }
  return out;
}

/** OurAirports navaids.csv rows → points for the requested navaid types. */
export function navaidFeatures(rows, types) {
  const wanted = new Set(types);
  const out = [];
  for (const r of rows) {
    if (!wanted.has(r.type)) continue;
    const khz = cleanNumber(r.frequency_khz, 0, 2e6);
    const feature = pointFeature(r.longitude_deg, r.latitude_deg, {
      name: cleanText(r.name),
      ident: cleanText(r.ident, 8),
      type: r.type,
      frequency:
        khz === null
          ? null
          : khz >= 10000
            ? `${(khz / 1000).toFixed(2)} MHz`
            : `${khz} kHz`,
      country: cleanText(r.iso_country, 4),
      airport: cleanText(r.associated_airport, 8),
      power: cleanText(r.power, 12),
    });
    if (feature) out.push(feature);
  }
  return out;
}

/** Smithsonian GVP Holocene volcano WFS GeoJSON. */
export function gvpFeatures(body) {
  return slimGeojson(body, {
    pick: [
      ['Volcano_Name', 'name'],
      ['Primary_Volcano_Type', 'type'],
      ['Last_Eruption_Year', 'last_eruption', 'number'],
      ['Country', 'country'],
      ['Elevation', 'elevation', 'number'],
      ['Tectonic_Setting', 'setting'],
      ['Volcano_Number', 'number'],
    ],
  }).map((f) => ({
    ...f,
    properties: {
      ...f.properties,
      link: f.properties.number
        ? `https://volcano.si.edu/volcano.cfm?vn=${encodeURIComponent(String(f.properties.number).slice(0, 8))}`
        : null,
    },
  }));
}

/** Wikipedia geosearch → article points. */
export function wikipediaFeatures(body, lang = 'en') {
  return (body?.query?.geosearch || [])
    .map((a) =>
      pointFeature(a.lon, a.lat, {
        name: cleanText(a.title),
        distance_m: cleanNumber(a.dist, 0, 100000),
        link: a.pageid
          ? `https://${lang}.wikipedia.org/?curid=${encodeURIComponent(String(a.pageid).slice(0, 12))}`
          : null,
      }),
    )
    .filter(Boolean);
}

/** Natural Earth countries → polygons carrying the indicators the choropleths color by. */
export function countryIndicatorFeatures(body) {
  return slimGeojson(body, {
    pick: [
      ['NAME', 'name'],
      ['POP_EST', 'population', 'number'],
      ['GDP_MD', 'gdp_musd', 'number'],
      ['INCOME_GRP', 'income'],
      ['ECONOMY', 'economy'],
      ['CONTINENT', 'continent'],
      ['ISO_A3', 'iso3'],
    ],
  }).map((f) => {
    const p = f.properties;
    const perCapita =
      p.population > 0 && p.gdp_musd > 0
        ? Math.round((p.gdp_musd * 1e6) / p.population)
        : null;
    return { ...f, properties: { ...p, gdp_per_capita: perCapita } };
  });
}

/** Quick summary used by tests and the response envelope. */
export function geometryCounts(features) {
  const counts = {};
  for (const f of features) {
    const t = f?.geometry?.type || 'none';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}
