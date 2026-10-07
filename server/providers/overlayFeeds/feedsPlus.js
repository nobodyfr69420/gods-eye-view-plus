/**
 * Overlay Library feeds, second wave: more live public feeds (trains, Baltic
 * AIS, EMSC/GeoNet quakes, storm reports, fireballs, internet outages,
 * biodiversity sightings, data centres, bike-share networks) and the one
 * keyed feed (Windy webcams). Same rules as ./feeds.js: fixed upstream
 * hosts, pure transforms to slim GeoJSON, cached by the proxy.
 */
import {
  cleanGeometry,
  cleanNumber,
  cleanText,
  cleanUrl,
  parseCsv,
  slimGeojson,
} from './parsers.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;
const NE_COUNTRIES =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

const live = (url, ttlMs = 5 * MIN, maxBytes = 12 * MB, extra = {}) => ({
  url,
  format: 'json',
  ttlMs,
  maxBytes,
  ...extra,
});
const daily = (url, maxBytes = 16 * MB, format = 'json', extra = {}) => ({
  url,
  format,
  ttlMs: DAY,
  disk: true,
  maxBytes,
  ...extra,
});
const point = (lon, lat) => {
  // Missing coordinates must not become "null island" (0, 0).
  if (lon == null || lat == null || lon === '' || lat === '') return null;
  if (Number(lon) === 0 && Number(lat) === 0) return null;
  const geometry = cleanGeometry({
    type: 'Point',
    coordinates: [Number(lon), Number(lat)],
  });
  return geometry && Math.abs(geometry.coordinates[1]) <= 90 ? geometry : null;
};
const feature = (geometry, properties) => {
  const clean = {};
  for (const [k, v] of Object.entries(properties))
    if (v !== null && v !== undefined && v !== '') clean[k] = v;
  return { type: 'Feature', geometry, properties: clean };
};

// ── Parsers (pure, exported for tests) ────────────────────────────────────

const COMPASS = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

/** Amtraker v3 `{ trainNum: [train, …] }` → points. */
export function amtrakFeatures(body) {
  const out = [];
  if (!body || typeof body !== 'object') return out;
  for (const list of Object.values(body)) {
    for (const t of Array.isArray(list) ? list : []) {
      const geometry = point(t?.lon, t?.lat);
      if (!geometry) continue;
      out.push(
        feature(geometry, {
          name: cleanText(
            `${t.routeName || 'Train'} ${t.trainNum || ''}`.trim(),
          ),
          route: cleanText(t.routeName),
          provider: cleanText(t.provider || 'Amtrak'),
          state: cleanText(t.trainState),
          speed_mph: cleanNumber(t.velocity, 0, 300),
          heading: COMPASS[String(t.heading || '').toUpperCase()] ?? null,
          origin: cleanText(t.origName),
          destination: cleanText(t.destName),
          next_stop: cleanText(t.eventName),
          updated: cleanText(t.lastValTS),
          color: /^#[0-9a-f]{6}$/i.test(t.iconColor) ? t.iconColor : null,
          link: cleanUrl(
            `https://amtraker.com/trains/${encodeURIComponent(String(t.trainNum || ''))}`,
          ),
        }),
      );
    }
  }
  return out;
}

const NAV_STATUS = [
  'Under way (engine)',
  'At anchor',
  'Not under command',
  'Restricted manoeuvrability',
  'Constrained by draught',
  'Moored',
  'Aground',
  'Fishing',
  'Under way (sailing)',
];
const SHIP_TYPE = (code) => {
  const n = Number(code);
  if (n >= 70 && n < 80) return 'Cargo';
  if (n >= 80 && n < 90) return 'Tanker';
  if (n >= 60 && n < 70) return 'Passenger';
  if (n === 30) return 'Fishing';
  if (n === 31 || n === 32 || n === 52) return 'Tug';
  if (n === 36 || n === 37) return 'Pleasure / sailing';
  if (n >= 40 && n < 50) return 'High-speed craft';
  if (n === 35) return 'Military';
  if (n === 51) return 'Search & rescue';
  if (n === 50) return 'Pilot';
  return Number.isFinite(n) && n > 0 ? 'Other' : 'Unknown';
};

/** Digitraffic Marine AIS locations (+ optional vessel metadata) → points. */
export function digitrafficAisFeatures(locations, vessels) {
  const meta = new Map();
  for (const v of Array.isArray(vessels) ? vessels : [])
    if (v?.mmsi) meta.set(v.mmsi, v);
  const out = [];
  for (const f of Array.isArray(locations?.features)
    ? locations.features
    : []) {
    const geometry = cleanGeometry(f?.geometry);
    if (!geometry) continue;
    const p = f.properties || {};
    const m = meta.get(p.mmsi || f.mmsi) || {};
    const heading = cleanNumber(p.heading, 0, 359);
    out.push(
      feature(geometry, {
        name: cleanText(m.name) || `MMSI ${p.mmsi || f.mmsi}`,
        mmsi: cleanNumber(p.mmsi || f.mmsi),
        type: SHIP_TYPE(m.shipType),
        destination: cleanText(m.destination),
        callsign: cleanText(m.callSign),
        speed_kn: cleanNumber(p.sog, 0, 102.2),
        course: cleanNumber(p.cog, 0, 359.9),
        heading: heading ?? cleanNumber(p.cog, 0, 359.9),
        status: NAV_STATUS[p.navStat] ?? null,
        time: cleanNumber(p.timestampExternal),
      }),
    );
  }
  return out;
}

/** EMSC FDSN GeoJSON → quake points. */
export function emscFeatures(body) {
  return slimGeojson(body, {
    pick: [
      ['mag', 'magnitude', 'number'],
      ['flynn_region', 'name'],
      ['time', 'time'],
      ['depth', 'depth_km', 'number'],
      ['magtype', 'mag_type'],
      ['auth', 'agency'],
      ['unid', 'unid'],
    ],
  }).map((f) => ({
    ...f,
    geometry: {
      type: 'Point',
      coordinates: f.geometry.coordinates.slice(0, 2),
    },
    properties: {
      ...f.properties,
      link: f.properties.unid
        ? `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(f.properties.unid)}`
        : undefined,
    },
  }));
}

/** GeoNet quake GeoJSON → quake points. */
export function geonetFeatures(body) {
  return slimGeojson(body, {
    pick: [
      ['magnitude', 'magnitude', 'number'],
      ['locality', 'name'],
      ['time', 'time'],
      ['depth', 'depth_km', 'number'],
      ['mmi', 'mmi', 'number'],
      ['quality', 'quality'],
      ['publicID', 'id'],
    ],
  }).map((f) => ({
    ...f,
    properties: {
      ...f.properties,
      magnitude:
        f.properties.magnitude === undefined
          ? undefined
          : Math.round(f.properties.magnitude * 10) / 10,
      link: f.properties.id
        ? `https://www.geonet.org.nz/earthquake/${encodeURIComponent(f.properties.id)}`
        : undefined,
    },
  }));
}

/** SPC storm-report CSV (three stacked tables) → points. */
export function spcReportFeatures(text, day = 'today') {
  const source = String(text || '');
  // parseCsv keys rows by the first header; the later tables' header rows
  // then arrive as ordinary rows whose first cell is "Time".
  const header = source.split(/\r?\n/, 1)[0].split(',');
  const rows = [header, ...parseCsv(source).map((o) => Object.values(o))];
  const out = [];
  let kind = null;
  for (const row of rows) {
    if (row[0] === 'Time') {
      kind =
        row[1] === 'F_Scale'
          ? 'Tornado'
          : row[1] === 'Speed'
            ? 'Wind'
            : row[1] === 'Size'
              ? 'Hail'
              : null;
      continue;
    }
    if (!kind || row.length < 7) continue;
    const geometry = point(row[6], row[5]);
    if (!geometry) continue;
    const magnitude = row[1] === 'UNK' ? null : cleanText(row[1]);
    out.push(
      feature(geometry, {
        name: `${kind} · ${cleanText(row[2]) || ''}, ${cleanText(row[4]) || ''}`,
        kind,
        magnitude:
          kind === 'Hail' && /^\d+$/.test(row[1])
            ? `${(Number(row[1]) / 100).toFixed(2)} in`
            : kind === 'Wind' && /^\d+$/.test(row[1])
              ? `${row[1]} mph`
              : magnitude,
        time_utc: cleanText(row[0]),
        county: cleanText(row[3]),
        comments: cleanText(row[7], 300),
        day,
      }),
    );
  }
  return out;
}

/** NASA/JPL CNEOS fireball API → points. */
export function fireballFeatures(body) {
  const fields = Array.isArray(body?.fields) ? body.fields : [];
  const col = (name) => fields.indexOf(name);
  const out = [];
  for (const row of Array.isArray(body?.data) ? body.data : []) {
    // Many fireballs have no published location: skip rather than plot at 0,0.
    if (row[col('lat')] == null || row[col('lon')] == null) continue;
    const lat =
      Number(row[col('lat')]) * (row[col('lat-dir')] === 'S' ? -1 : 1);
    const lon =
      Number(row[col('lon')]) * (row[col('lon-dir')] === 'W' ? -1 : 1);
    const geometry = point(lon, lat);
    if (!geometry) continue;
    out.push(
      feature(geometry, {
        name: `Fireball ${cleanText(row[col('date')]) || ''}`.trim(),
        time: cleanText(row[col('date')]),
        energy_e10j: cleanNumber(row[col('energy')]),
        impact_kt: cleanNumber(row[col('impact-e')]),
        altitude_km: cleanNumber(row[col('alt')]),
        velocity_kms: cleanNumber(row[col('vel')]),
      }),
    );
  }
  return out;
}

/** Natural Earth countries with the codes joins need. */
export function neCountryShapes(body) {
  return slimGeojson(body, {
    pick: [
      ['NAME', 'name'],
      ['ISO_A2_EH', 'iso2'],
      ['ISO_A3_EH', 'iso3'],
      ['ADM0_A3', 'adm0'],
      ['CONTINENT', 'continent'],
      ['REGION_WB', 'region'],
    ],
  }).map((f) => {
    const p = f.properties;
    const iso3 = /^[A-Z]{3}$/.test(p.iso3 || '') ? p.iso3 : p.adm0;
    const iso2 = /^[A-Z]{2}$/.test(p.iso2 || '') ? p.iso2 : null;
    return { ...f, properties: { ...p, iso3, iso2 } };
  });
}

/** IODA country outage summary joined onto country polygons. */
export function iodaOutageFeatures(countries, summary) {
  const scores = new Map();
  for (const item of Array.isArray(summary?.data) ? summary.data : []) {
    const code = item?.entity?.code;
    if (typeof code === 'string' && item?.entity?.type === 'country')
      scores.set(code.toUpperCase(), item);
  }
  const out = [];
  for (const shape of neCountryShapes(countries)) {
    const hit = scores.get(shape.properties.iso2);
    if (!hit) continue;
    const overall = Number(hit.scores?.overall) || 0;
    const signals = Object.keys(hit.scores || {})
      .filter((k) => k !== 'overall')
      .map((k) => k.split('.')[0])
      .join(', ');
    out.push({
      ...shape,
      properties: {
        name: shape.properties.name,
        iso2: shape.properties.iso2,
        score: Math.round(overall),
        severity: Math.max(
          1,
          Math.min(5, Math.round(Math.log10(Math.max(overall, 10)))),
        ),
        events: cleanNumber(hit.event_cnt),
        signals,
        link: `https://ioda.inetintel.cc.gatech.edu/country/${shape.properties.iso2}`,
      },
    });
  }
  return out;
}

/** iNaturalist research-grade observations (open geoprivacy) → points. */
export function inatFeatures(body) {
  const out = [];
  for (const o of Array.isArray(body?.results) ? body.results : []) {
    if (o?.geoprivacy || o?.taxon_geoprivacy === 'private' || o?.obscured)
      continue;
    const geometry = cleanGeometry(o?.geojson);
    if (!geometry) continue;
    const taxon = o.taxon || {};
    out.push(
      feature(geometry, {
        name: cleanText(
          taxon.preferred_common_name || taxon.name || o.species_guess,
        ),
        scientific: cleanText(taxon.name),
        group: cleanText(taxon.iconic_taxon_name) || 'Other',
        observed: cleanText(o.observed_on),
        photo: cleanUrl(o.photos?.[0]?.url?.replace('/square.', '/medium.')),
        link: cleanUrl(o.uri),
      }),
    );
  }
  return out;
}

/** PeeringDB facilities → points. */
export function peeringdbFeatures(body) {
  const out = [];
  for (const f of Array.isArray(body?.data) ? body.data : []) {
    if (f?.status && f.status !== 'ok') continue;
    const geometry = point(f?.longitude, f?.latitude);
    if (!geometry) continue;
    out.push(
      feature(geometry, {
        name: cleanText(f.name),
        operator: cleanText(f.org_name),
        city: cleanText(f.city),
        country: cleanText(f.country),
        networks: cleanNumber(f.net_count),
        exchanges: cleanNumber(f.ix_count),
        link: cleanUrl(`https://www.peeringdb.com/fac/${f.id}`),
      }),
    );
  }
  return out;
}

/** CityBikes network index → points. */
export function citybikesFeatures(body) {
  const out = [];
  for (const n of Array.isArray(body?.networks) ? body.networks : []) {
    const geometry = point(n?.location?.longitude, n?.location?.latitude);
    if (!geometry) continue;
    out.push(
      feature(geometry, {
        name: cleanText(n.name),
        city: cleanText(n.location.city),
        country: cleanText(n.location.country),
        operator: cleanText(
          Array.isArray(n.company) ? n.company.join(', ') : n.company,
        ),
      }),
    );
  }
  return out;
}

/** Windy Webcams v3 → points. */
export function windyWebcamFeatures(body) {
  const out = [];
  for (const w of Array.isArray(body?.webcams) ? body.webcams : []) {
    if (w?.status && w.status !== 'active') continue;
    const geometry = point(w?.location?.longitude, w?.location?.latitude);
    if (!geometry) continue;
    out.push(
      feature(geometry, {
        name: cleanText(w.title),
        city: cleanText(w.location.city),
        country: cleanText(w.location.country),
        photo: cleanUrl(
          w.images?.current?.preview || w.images?.current?.thumbnail,
        ),
        link: cleanUrl(
          w.urls?.detail || `https://www.windy.com/webcams/${w.webcamId}`,
        ),
      }),
    );
  }
  return out;
}

// ── Feed specs ────────────────────────────────────────────────────────────

const DIGITRAFFIC = {
  headers: { 'Digitraffic-User': 'gods-eye-view/overlay-library' },
};
const keyed = (envVar) => {
  const value = String(process.env[envVar] ?? '').trim();
  if (!value)
    throw Object.assign(new Error('key_missing'), { upstreamStatus: 424 });
  return value;
};

export const PLUS_FEEDS = [
  [
    'amtrak-trains',
    {
      attribution: 'Amtraker (Amtrak public train status)',
      upstreams: () => [
        live('https://api-v3.amtraker.com/v3/trains', MIN, 16 * MB),
      ],
      transform: ([body]) => amtrakFeatures(body),
      staleMs: HOUR,
    },
  ],
  [
    'digitraffic-ais',
    {
      attribution: 'Fintraffic / Digitraffic (CC BY 4.0)',
      upstreams: () => [
        live(
          'https://meri.digitraffic.fi/api/ais/v1/locations',
          MIN,
          24 * MB,
          DIGITRAFFIC,
        ),
        {
          ...live(
            'https://meri.digitraffic.fi/api/ais/v1/vessels',
            HOUR,
            24 * MB,
            DIGITRAFFIC,
          ),
          optional: true,
        },
      ],
      transform: ([locations, vessels]) =>
        digitrafficAisFeatures(locations, vessels),
      staleMs: HOUR,
    },
  ],
  [
    'emsc-quakes',
    {
      attribution: 'EMSC / seismicportal.eu',
      upstreams: () => [
        live(
          'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=1000&minmag=2&orderby=time',
          5 * MIN,
        ),
      ],
      transform: ([body]) => emscFeatures(body),
    },
  ],
  [
    'geonet-quakes',
    {
      attribution: 'GeoNet (CC BY 4.0)',
      upstreams: () => [live('https://api.geonet.org.nz/quake?MMI=2', 5 * MIN)],
      transform: ([body]) => geonetFeatures(body),
    },
  ],
  [
    'spc-storm-reports',
    {
      attribution: 'NOAA Storm Prediction Center',
      upstreams: () => [
        live(
          'https://www.spc.noaa.gov/climo/reports/today.csv',
          10 * MIN,
          4 * MB,
          { format: 'text' },
        ),
        {
          ...live(
            'https://www.spc.noaa.gov/climo/reports/yesterday.csv',
            HOUR,
            4 * MB,
            {
              format: 'text',
            },
          ),
          optional: true,
        },
      ],
      transform: ([today, yesterday]) => [
        ...spcReportFeatures(today, 'today'),
        ...spcReportFeatures(yesterday, 'yesterday'),
      ],
    },
  ],
  [
    'cneos-fireballs',
    {
      attribution: 'NASA/JPL CNEOS',
      upstreams: () => [
        daily('https://ssd-api.jpl.nasa.gov/fireball.api?req-loc=true', 4 * MB),
      ],
      transform: ([body]) => fireballFeatures(body),
      staleMs: 30 * DAY,
    },
  ],
  [
    'ioda-outages',
    {
      attribution: 'IODA (Georgia Tech) · Natural Earth',
      upstreams: () => {
        const until = Math.floor(Date.now() / (10 * MIN)) * (10 * 60);
        return [
          daily(NE_COUNTRIES, 12 * MB),
          live(
            `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/summary?entityType=country&from=${until - 86_400}&until=${until}&limit=500`,
            10 * MIN,
            4 * MB,
          ),
        ].map((spec, i) => (i === 0 ? { ...spec, ttlMs: 7 * DAY } : spec));
      },
      transform: ([countries, summary]) =>
        iodaOutageFeatures(countries, summary),
    },
  ],
  [
    'inat-observations',
    {
      attribution: 'iNaturalist (observations CC BY-NC unless noted)',
      query: 'bbox',
      maxSpanDeg: 3,
      upstreams: ({ bbox }) => [
        live(
          `https://api.inaturalist.org/v2/observations?swlat=${bbox.south}&swlng=${bbox.west}&nelat=${bbox.north}&nelng=${bbox.east}&per_page=200&order_by=observed_on&order=desc&quality_grade=research&geoprivacy=open&photos=true&fields=id,uri,observed_on,geojson,geoprivacy,taxon_geoprivacy,obscured,species_guess,taxon.name,taxon.preferred_common_name,taxon.iconic_taxon_name,photos.url`,
          15 * MIN,
          8 * MB,
        ),
      ],
      transform: ([body]) => inatFeatures(body),
    },
  ],
  [
    'peeringdb-facilities',
    {
      attribution: 'PeeringDB (CC0-style open data)',
      upstreams: () => [
        {
          ...daily(
            'https://www.peeringdb.com/api/fac?depth=0&fields=id,name,org_name,city,country,latitude,longitude,net_count,ix_count,status',
            24 * MB,
          ),
          ttlMs: 7 * DAY,
        },
      ],
      transform: ([body]) => peeringdbFeatures(body),
      staleMs: 60 * DAY,
    },
  ],
  [
    'citybikes-networks',
    {
      attribution: 'CityBikes (AGPL data API)',
      upstreams: () => [
        {
          ...daily('https://api.citybik.es/v2/networks', 8 * MB),
          ttlMs: 7 * DAY,
        },
      ],
      transform: ([body]) => citybikesFeatures(body),
      staleMs: 60 * DAY,
    },
  ],
  [
    'windy-webcams',
    {
      attribution: 'Windy Webcams',
      query: 'point',
      upstreams: ({ point: p }) => [
        live(
          `https://api.windy.com/webcams/api/v3/webcams?nearby=${p.lat},${p.lon},50&include=location,images,urls&limit=50`,
          10 * MIN,
          4 * MB,
          { headers: { 'x-windy-api-key': keyed('WINDY_WEBCAMS_API_KEY') } },
        ),
      ],
      transform: ([body]) => windyWebcamFeatures(body),
    },
  ],
];
