/**
 * The Overlay Library feed allowlist. A browser can only ask the proxy for a
 * feed id listed here; every upstream URL is fixed (or built from a validated,
 * quantized bbox/point), so the endpoint can never be turned into an open
 * proxy. Each feed names its upstream bodies and a pure transform from
 * ./parsers.js that returns slim GeoJSON features.
 */
import {
  airportFeatures,
  auroraFeatures,
  coopsFeatures,
  countryIndicatorFeatures,
  eonetFeatures,
  gdacsFeatures,
  gvpFeatures,
  hazelFeatures,
  navaidFeatures,
  ndbcFeatures,
  NWS_GROUPS,
  nwpsFloodFeatures,
  nwsAlertFeatures,
  parseCsv,
  powerPlantFeatures,
  sensorCommunityFeatures,
  slimGeojson,
  spcFeatures,
  usgsVolcanoFeatures,
  wikipediaFeatures,
} from './parsers.js';
import { PLUS_FEEDS } from './feedsPlus.js';
import { WORLD_BANK_FEEDS } from './worldBank.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

const NE_BASE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const GPPD_URL =
  'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv';
const OA_BASE =
  'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/';
const PLATES_BASE =
  'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/';

/** Static reference upstream (GitHub-hosted, disk cached for a week). */
const staticUpstream = (url, maxBytes = 16 * MB, format = 'json') => ({
  url,
  format,
  ttlMs: 7 * DAY,
  disk: true,
  maxBytes,
});
/** Live upstream with a short memory TTL. */
const liveUpstream = (
  url,
  ttlMs = 5 * MIN,
  maxBytes = 12 * MB,
  extra = {},
) => ({
  url,
  format: 'json',
  ttlMs,
  maxBytes,
  ...extra,
});

const FEEDS = new Map();
function feed(id, spec) {
  if (FEEDS.has(id)) throw new Error(`Duplicate overlay feed: ${id}`);
  FEEDS.set(id, Object.freeze({ id, query: null, staleMs: 6 * HOUR, ...spec }));
}

// ── NASA EONET natural events (one feed per category) ─────────────────────
const EONET_CATEGORIES = [
  'wildfires',
  'severeStorms',
  'volcanoes',
  'floods',
  'seaLakeIce',
  'dustHaze',
  'drought',
  'landslides',
  'snow',
  'tempExtremes',
  'waterColor',
  'manmade',
  'earthquakes',
];
for (const category of EONET_CATEGORIES) {
  feed(`eonet-${category}`, {
    attribution: 'NASA EONET',
    upstreams: () => [
      liveUpstream(
        `https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=60&category=${category}`,
        15 * MIN,
      ),
    ],
    transform: ([body]) => eonetFeatures(body),
  });
}

// ── GDACS global disaster alerts (one feed per hazard type) ───────────────
const gdacsUpstreams = () => {
  const now = new Date();
  const from = new Date(now.getTime() - 60 * DAY).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const search = (type) =>
    liveUpstream(
      `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${type}&fromdate=${from}&todate=${to}&pagesize=100`,
      20 * MIN,
      8 * MB,
      { optional: true },
    );
  return [
    liveUpstream(
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/events4app',
      15 * MIN,
    ),
    search('VO'),
    search('DR'),
  ];
};
for (const [type, slug] of [
  ['EQ', 'earthquakes'],
  ['TC', 'cyclones'],
  ['FL', 'floods'],
  ['VO', 'volcanoes'],
  ['DR', 'droughts'],
  ['WF', 'wildfires'],
]) {
  feed(`gdacs-${slug}`, {
    attribution: 'GDACS (UN / European Commission)',
    upstreams: gdacsUpstreams,
    transform: (bodies) => gdacsFeatures(bodies.filter(Boolean), type),
  });
}

// ── USGS earthquakes & volcanoes ──────────────────────────────────────────
const usgsQuakes = (file) => ({
  attribution: 'USGS Earthquake Hazards Program',
  upstreams: () => [
    liveUpstream(
      `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${file}.geojson`,
      5 * MIN,
    ),
  ],
  transform: ([body]) =>
    slimGeojson(body, {
      pick: [
        ['mag', 'magnitude', 'number'],
        ['place', 'name'],
        ['time', 'time', 'number'],
        'alert',
        ['tsunami', 'tsunami', 'number'],
        ['sig', 'significance', 'number'],
        ['url', 'link', 'url'],
      ],
    }),
});
feed('usgs-significant-month', usgsQuakes('significant_month'));
feed('usgs-m45-week', usgsQuakes('4.5_week'));
feed('usgs-m25-week', usgsQuakes('2.5_week'));
feed('usgs-all-day', usgsQuakes('all_day'));
feed('usgs-all-hour', usgsQuakes('all_hour'));
feed('usgs-volcano-alerts', {
  attribution: 'USGS Volcano Hazards Program',
  upstreams: () => [
    liveUpstream(
      'https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated',
      30 * MIN,
      2 * MB,
    ),
  ],
  transform: ([body]) => usgsVolcanoFeatures(body),
});
feed('gvp-holocene-volcanoes', {
  attribution: 'Smithsonian Global Volcanism Program',
  upstreams: () => [
    {
      ...staticUpstream(
        'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json',
        24 * MB,
      ),
    },
  ],
  transform: ([body]) => gvpFeatures(body),
});

// ── NOAA NCEI historical hazards (HazEL, paged) ───────────────────────────
const hazel = (path, kind, pages = 4) => ({
  attribution: 'NOAA NCEI Natural Hazards (HazEL)',
  upstreams: () =>
    Array.from({ length: pages }, (_, i) => ({
      ...staticUpstream(
        `https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/${path}&page=${i + 1}`,
        6 * MB,
      ),
      ttlMs: DAY,
      optional: i > 0,
    })),
  transform: (bodies) => hazelFeatures(bodies.filter(Boolean), kind),
});
feed('ncei-tsunamis', hazel('tsunamis/events?minYear=1950', 'tsunamis', 5));
feed('ncei-earthquakes', hazel('earthquakes?minYear=1990', 'earthquakes', 8));
feed('ncei-eruptions', hazel('volcanoes?minYear=1800', 'volcanoes', 4));

// ── NOAA NWS alerts (storm-based polygons), split by event group ──────────
for (const group of Object.keys(NWS_GROUPS)) {
  feed(`nws-${group}`, {
    attribution: 'NOAA National Weather Service',
    upstreams: () => [
      liveUpstream(
        'https://api.weather.gov/alerts/active?status=actual',
        3 * MIN,
        40 * MB,
        { headers: { Accept: 'application/geo+json' } },
      ),
    ],
    transform: ([body]) => nwsAlertFeatures(body, NWS_GROUPS[group]),
    staleMs: 2 * HOUR,
  });
}

// ── NOAA SPC convective outlooks ──────────────────────────────────────────
for (const [id, file] of [
  ['spc-day1-categorical', 'day1otlk_cat'],
  ['spc-day1-tornado', 'day1otlk_torn'],
  ['spc-day1-hail', 'day1otlk_hail'],
  ['spc-day1-wind', 'day1otlk_wind'],
  ['spc-day2-categorical', 'day2otlk_cat'],
  ['spc-day3-categorical', 'day3otlk_cat'],
]) {
  feed(id, {
    attribution: 'NOAA Storm Prediction Center',
    upstreams: () => [
      liveUpstream(
        `https://www.spc.noaa.gov/products/outlook/${file}.lyr.geojson`,
        15 * MIN,
        8 * MB,
      ),
    ],
    transform: ([body]) => spcFeatures(body),
  });
}

// ── NOAA Aviation Weather Center ──────────────────────────────────────────
feed('awc-sigmets', {
  attribution: 'NOAA Aviation Weather Center',
  upstreams: () => [
    liveUpstream(
      'https://aviationweather.gov/api/data/airsigmet?format=geojson',
      5 * MIN,
    ),
  ],
  transform: ([body]) =>
    slimGeojson(body, {
      pick: [
        ['airSigmetType', 'type'],
        'hazard',
        ['severity', 'severity', 'number'],
        ['validTimeFrom', 'from'],
        ['validTimeTo', 'to'],
        ['altitudeHi1', 'top_ft', 'number'],
        ['rawAirSigmet', 'raw'],
      ],
    }),
});
feed('awc-intl-sigmets', {
  attribution: 'NOAA Aviation Weather Center',
  upstreams: () => [
    liveUpstream(
      'https://aviationweather.gov/api/data/isigmet?format=geojson',
      5 * MIN,
    ),
  ],
  transform: ([body]) =>
    slimGeojson(body, {
      pick: [
        'hazard',
        'qualifier',
        ['firName', 'name'],
        ['validTimeFrom', 'from'],
        ['validTimeTo', 'to'],
        ['top', 'top_ft', 'number'],
        ['rawSigmet', 'raw'],
      ],
    }),
});
const bboxParam = (b) => `${b.south},${b.west},${b.north},${b.east}`;
feed('awc-metars', {
  attribution: 'NOAA Aviation Weather Center',
  query: 'bbox',
  maxSpanDeg: 8,
  upstreams: ({ bbox }) => [
    liveUpstream(
      `https://aviationweather.gov/api/data/metar?format=geojson&bbox=${bboxParam(bbox)}`,
      5 * MIN,
      6 * MB,
    ),
  ],
  transform: ([body]) =>
    slimGeojson(body, {
      pick: [
        ['id', 'name'],
        'site',
        ['fltcat', 'category'],
        ['temp', 'temp_c', 'number'],
        ['wspd', 'wind_kt', 'number'],
        ['wgst', 'gust_kt', 'number'],
        ['visib', 'visibility'],
        ['obsTime', 'time'],
        ['rawOb', 'raw'],
      ],
    }),
  staleMs: HOUR,
});
feed('awc-pireps', {
  attribution: 'NOAA Aviation Weather Center',
  query: 'bbox',
  maxSpanDeg: 30,
  upstreams: ({ bbox }) => [
    liveUpstream(
      `https://aviationweather.gov/api/data/pirep?format=geojson&age=3&bbox=${bboxParam(bbox)}`,
      5 * MIN,
      6 * MB,
    ),
  ],
  transform: ([body]) =>
    slimGeojson(body, {
      pick: [
        ['icaoId', 'name'],
        ['airepType', 'type'],
        ['acType', 'aircraft'],
        ['fltlvl', 'flight_level', 'number'],
        ['tbInt1', 'turbulence'],
        ['icgInt1', 'icing'],
        ['obsTime', 'time'],
        ['rawOb', 'raw'],
      ],
    }),
  staleMs: HOUR,
});

// ── Air quality, ocean and space-weather observations ─────────────────────
feed('sensor-community-dust', {
  attribution: 'Sensor.Community (luftdaten)',
  upstreams: () => [
    liveUpstream(
      'https://data.sensor.community/static/v2/data.dust.min.json',
      10 * MIN,
      48 * MB,
    ),
  ],
  transform: ([body]) => sensorCommunityFeatures(body, { kind: 'dust' }),
});
feed('sensor-community-temperature', {
  attribution: 'Sensor.Community (luftdaten)',
  upstreams: () => [
    liveUpstream(
      'https://data.sensor.community/static/v2/data.temp.min.json',
      10 * MIN,
      48 * MB,
    ),
  ],
  transform: ([body]) => sensorCommunityFeatures(body, { kind: 'temperature' }),
});
feed('ndbc-buoys', {
  attribution: 'NOAA National Data Buoy Center',
  upstreams: () => [
    {
      ...liveUpstream(
        'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt',
        10 * MIN,
        4 * MB,
      ),
      format: 'text',
    },
  ],
  transform: ([text]) => ndbcFeatures(text),
});
feed('coops-tide-stations', {
  attribution: 'NOAA CO-OPS Tides & Currents',
  upstreams: () => [
    {
      ...staticUpstream(
        'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels',
        8 * MB,
      ),
      ttlMs: DAY,
    },
  ],
  transform: ([body]) => coopsFeatures(body),
});
feed('nwps-flood-gauges', {
  attribution: 'NOAA National Water Prediction Service',
  upstreams: () => [
    liveUpstream(
      'https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=-180&bbox.ymin=10&bbox.xmax=-60&bbox.ymax=72&srid=EPSG_4326',
      20 * MIN,
      64 * MB,
    ),
  ],
  transform: ([body]) => nwpsFloodFeatures(body),
});
feed('swpc-aurora', {
  attribution: 'NOAA Space Weather Prediction Center (OVATION)',
  upstreams: () => [
    liveUpstream(
      'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
      10 * MIN,
      8 * MB,
    ),
  ],
  transform: ([body]) => auroraFeatures(body, 8),
});
feed('swpc-kp', {
  attribution: 'NOAA Space Weather Prediction Center',
  upstreams: () => [
    liveUpstream(
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
      15 * MIN,
      MB,
    ),
  ],
  // Not geographic: one null-geometry record per 3-hour Kp value for the stats tab.
  transform: ([body]) =>
    (Array.isArray(body) ? body : [])
      .map((row) => {
        const time = Array.isArray(row) ? row[0] : row?.time_tag;
        const kp = Number(Array.isArray(row) ? row[1] : row?.Kp);
        return Number.isFinite(kp) && typeof time === 'string'
          ? { type: 'Feature', geometry: null, properties: { time, kp } }
          : null;
      })
      .filter(Boolean),
});

// ── Wikipedia (viewport point) ────────────────────────────────────────────
feed('wikipedia-nearby', {
  attribution: 'Wikipedia (CC BY-SA)',
  query: 'point',
  upstreams: ({ point }) => [
    liveUpstream(
      `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${point.lat}%7C${point.lon}&gsradius=10000&gslimit=500&format=json`,
      30 * MIN,
      2 * MB,
    ),
  ],
  transform: ([body]) => wikipediaFeatures(body),
  staleMs: DAY,
});

// ── WRI Global Power Plant Database (one feed per fuel group) ─────────────
const POWER = {
  nuclear: ['Nuclear'],
  coal: ['Coal', 'Petcoke'],
  gas: ['Gas', 'Cogeneration'],
  oil: ['Oil'],
  hydro: ['Hydro'],
  solar: ['Solar'],
  wind: ['Wind'],
  geothermal: ['Geothermal'],
  bioenergy: ['Biomass', 'Waste'],
  storage: ['Storage'],
  marine: ['Wave and Tidal'],
};
for (const [slug, fuels] of Object.entries(POWER)) {
  feed(`power-${slug}`, {
    attribution: 'WRI Global Power Plant Database (CC BY 4.0)',
    upstreams: () => [staticUpstream(GPPD_URL, 24 * MB, 'csv')],
    transform: ([rows]) => powerPlantFeatures(rows, fuels),
    staleMs: 30 * DAY,
  });
}

// ── OurAirports (public domain) ───────────────────────────────────────────
const AIRPORTS = {
  'airports-large': ['large_airport'],
  'airports-medium': ['medium_airport'],
  'airports-small': ['small_airport'],
  heliports: ['heliport'],
  'seaplane-bases': ['seaplane_base'],
  'airports-closed': ['closed'],
  balloonports: ['balloonport'],
};
for (const [slug, types] of Object.entries(AIRPORTS)) {
  feed(`oa-${slug}`, {
    attribution: 'OurAirports (public domain)',
    upstreams: () => [staticUpstream(`${OA_BASE}airports.csv`, 32 * MB, 'csv')],
    transform: ([rows]) => airportFeatures(rows, types),
    staleMs: 30 * DAY,
  });
}
const NAVAIDS = {
  'navaids-vor': ['VOR', 'VOR-DME', 'VORTAC'],
  'navaids-ndb': ['NDB', 'NDB-DME'],
  'navaids-tacan': ['TACAN', 'DME'],
};
for (const [slug, types] of Object.entries(NAVAIDS)) {
  feed(`oa-${slug}`, {
    attribution: 'OurAirports (public domain)',
    upstreams: () => [staticUpstream(`${OA_BASE}navaids.csv`, 8 * MB, 'csv')],
    transform: ([rows]) => navaidFeatures(rows, types),
    staleMs: 30 * DAY,
  });
}

// ── Tectonics (PB2002, Bird 2003; ODC-BY) ─────────────────────────────────
feed('plates-boundaries', {
  attribution: 'Bird (2003) PB2002 via fraxen/tectonicplates (ODC-BY)',
  upstreams: () => [
    staticUpstream(`${PLATES_BASE}PB2002_boundaries.json`, 4 * MB),
  ],
  transform: ([body]) =>
    slimGeojson(body, {
      pick: [
        ['Name', 'name'],
        ['Type', 'type'],
        ['PlateA', 'plate_a'],
        ['PlateB', 'plate_b'],
      ],
    }),
  staleMs: 365 * DAY,
});
feed('plates-orogens', {
  attribution: 'Bird (2003) PB2002 via fraxen/tectonicplates (ODC-BY)',
  upstreams: () => [
    staticUpstream(`${PLATES_BASE}PB2002_orogens.json`, 4 * MB),
  ],
  transform: ([body]) => slimGeojson(body, { pick: [['Name', 'name']] }),
  staleMs: 365 * DAY,
});

// ── Natural Earth (public domain) ─────────────────────────────────────────
const naturalEarth = (file, pick = [['name', 'name']], filter = null) => ({
  attribution: 'Natural Earth (public domain)',
  upstreams: () => [staticUpstream(`${NE_BASE}${file}.geojson`, 12 * MB)],
  transform: ([body]) => slimGeojson(body, { pick, filter }),
  staleMs: 365 * DAY,
});
const PLACE_PICK = [
  ['name', 'name'],
  ['adm0name', 'country'],
  ['pop_max', 'population', 'number'],
  ['featurecla', 'class'],
];
feed(
  'ne-populated-places',
  naturalEarth('ne_10m_populated_places_simple', PLACE_PICK),
);
feed(
  'ne-capitals',
  naturalEarth('ne_10m_populated_places_simple', PLACE_PICK, (p) =>
    /^Admin-0 capital/.test(p.featurecla || ''),
  ),
);
feed(
  'ne-state-capitals',
  naturalEarth('ne_10m_populated_places_simple', PLACE_PICK, (p) =>
    /^Admin-1 capital/.test(p.featurecla || ''),
  ),
);
feed(
  'ne-megacities',
  naturalEarth(
    'ne_10m_populated_places_simple',
    PLACE_PICK,
    (p) => Number(p.pop_max) >= 10_000_000,
  ),
);
feed(
  'ne-airports',
  naturalEarth('ne_10m_airports', [
    ['name', 'name'],
    ['iata_code', 'iata'],
    ['gps_code', 'ident'],
    ['type', 'type'],
    ['wikipedia', 'link', 'url'],
  ]),
);
feed(
  'ne-ports',
  naturalEarth('ne_10m_ports', [
    ['name', 'name'],
    ['website', 'link', 'url'],
  ]),
);
feed(
  'ne-time-zones',
  naturalEarth('ne_10m_time_zones', [
    ['time_zone', 'name'],
    ['zone', 'offset', 'number'],
    ['places', 'places'],
    ['map_color8', 'band', 'number'],
  ]),
);
feed(
  'ne-marine-areas',
  naturalEarth('ne_50m_geography_marine_polys', [
    ['name', 'name'],
    ['featurecla', 'class'],
  ]),
);
feed(
  'ne-highest-points',
  naturalEarth('ne_10m_geography_regions_elevation_points', [
    ['name', 'name'],
    ['elevation', 'elevation', 'number'],
    ['region', 'region'],
    ['featurecla', 'class'],
  ]),
);
feed(
  'ne-physical-regions',
  naturalEarth('ne_10m_geography_regions_points', [
    ['name', 'name'],
    ['featurecla', 'class'],
    ['region', 'region'],
  ]),
);
feed('ne-reefs', naturalEarth('ne_10m_reefs', []));
feed('ne-glaciers', naturalEarth('ne_50m_glaciated_areas', []));
feed('ne-ice-shelves', naturalEarth('ne_50m_antarctic_ice_shelves_polys', []));
feed(
  'ne-urban-areas',
  naturalEarth('ne_50m_urban_areas', [['area_sqkm', 'area_km2', 'number']]),
);
feed(
  'ne-disputed-areas',
  naturalEarth('ne_10m_admin_0_disputed_areas', [
    ['NAME', 'name'],
    ['NOTE_BRK', 'note'],
    ['SOVEREIGNT', 'sovereign'],
  ]),
);
feed('ne-lakes', naturalEarth('ne_50m_lakes', [['name', 'name']]));
feed(
  'ne-rivers',
  naturalEarth('ne_50m_rivers_lake_centerlines', [['name', 'name']]),
);
feed('ne-playas', naturalEarth('ne_50m_playas', [['name', 'name']]));
feed(
  'ne-antarctic-claims',
  naturalEarth('ne_10m_admin_0_antarctic_claims', [
    ['name', 'name'],
    ['sovereignt', 'sovereign'],
    ['type', 'type'],
  ]),
);
feed(
  'ne-us-parks',
  naturalEarth('ne_10m_parks_and_protected_lands_area', [
    ['unit_name', 'name'],
    ['unit_type', 'type'],
  ]),
);
feed(
  'ne-continental-shelf',
  naturalEarth('ne_10m_bathymetry_K_200', [['depth', 'depth_m', 'number']]),
);
feed(
  'ne-abyssal-6000',
  naturalEarth('ne_10m_bathymetry_E_6000', [['depth', 'depth_m', 'number']]),
);
feed(
  'ne-country-borders',
  naturalEarth('ne_50m_admin_0_boundary_lines_land', [
    ['NAME', 'name'],
    ['FEATURECLA', 'class'],
  ]),
);
feed(
  'ne-state-borders',
  naturalEarth('ne_50m_admin_1_states_provinces_lines', [
    ['NAME', 'name'],
    ['ADM0_NAME', 'country'],
  ]),
);
feed(
  'ne-maritime-boundaries',
  naturalEarth('ne_10m_admin_0_boundary_lines_maritime_indicator', [
    ['FEATURECLA', 'name'],
    ['NOTE', 'note'],
  ]),
);
feed('ne-countries', {
  attribution: 'Natural Earth (public domain)',
  upstreams: () => [
    staticUpstream(`${NE_BASE}ne_50m_admin_0_countries.geojson`, 12 * MB),
  ],
  transform: ([body]) => countryIndicatorFeatures(body),
  staleMs: 365 * DAY,
});

// ── Second wave (./feedsPlus.js) and World Bank indicators (./worldBank.js)
for (const [id, spec] of [...PLUS_FEEDS, ...WORLD_BANK_FEEDS]) feed(id, spec);

/** Look up a feed by id (null when not allowlisted). */
export function getOverlayFeed(id) {
  return typeof id === 'string' && FEEDS.has(id) ? FEEDS.get(id) : null;
}

/** All allowlisted feed ids (tests and documentation). */
export function overlayFeedIds() {
  return [...FEEDS.keys()];
}

export { parseCsv };
