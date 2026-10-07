/**
 * The Overlay Library catalog: every overlay the panel can switch on.
 *
 * Pure data — no Cesium, no DOM, no network — so it can be validated by unit
 * tests and listed in documentation. Four kinds:
 *   imagery  — raster tiles draped on the globe (NASA GIBS WMS, XYZ tile sets)
 *   feed     — GeoJSON from the local allowlisted proxy (/api/overlay-feed/<id>)
 *   osm      — OpenStreetMap features decoded from OpenFreeMap vector tiles
 *   computed — geometry computed in the browser (terminator, grids, rings…)
 *
 * Style keys (all optional): color, size, sizeBy {prop, domain, range},
 * colorBy {prop, map | stops | direct}, label (prop), labelMax, width,
 * fill (alpha), outline (bool), extrude {prop}.
 * Info fields: [label, prop, format] where format ∈ text|int|num:N|time|
 * link|mw|m|ft|km|pct.
 */

import { addPlusDefinitions } from './definitionsPlus.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

const defs = [];
const add = (def) => defs.push(def);
add.last = () => defs[defs.length - 1];

// ── Builders ──────────────────────────────────────────────────────────────

function gibs(id, name, category, layer, description, opts = {}) {
  add({
    id: `gibs-${id}`,
    name,
    category,
    kind: 'imagery',
    source: 'NASA GIBS',
    description,
    imagery: {
      provider: 'wms',
      url: GIBS_WMS,
      layers: layer,
      time: opts.time ?? 'default',
      alpha: opts.alpha ?? 0.75,
      maxLevel: opts.maxLevel ?? 8,
    },
    legend: opts.legend ?? null,
    tags: opts.tags ?? '',
  });
}

function tiles(id, name, category, url, source, description, opts = {}) {
  add({
    id,
    name,
    category,
    kind: 'imagery',
    source,
    description,
    imagery: {
      provider: 'xyz',
      url,
      alpha: opts.alpha ?? 0.9,
      maxLevel: opts.maxLevel ?? 18,
      minLevel: opts.minLevel ?? 0,
      subdomains: opts.subdomains,
    },
    tags: opts.tags ?? '',
  });
}

function feed(id, name, category, source, description, spec = {}) {
  add({
    id,
    name,
    category,
    kind: 'feed',
    source,
    description,
    feed: spec.feed ?? id,
    query: spec.query ?? null,
    maxSpanDeg: spec.maxSpanDeg ?? null,
    maxAltitudeM: spec.maxAltitudeM ?? null,
    refreshMs: spec.refreshMs ?? null,
    geometry: spec.geometry ?? 'point',
    style: spec.style ?? {},
    info: spec.info ?? { title: 'name', fields: [] },
    statsBy: spec.statsBy ?? null,
    statsValue: spec.statsValue ?? null,
    legend: spec.legend ?? null,
    tags: spec.tags ?? '',
  });
}

const OSM_MAX_ALT = 30_000;

function osm(id, name, category, match, description, spec = {}) {
  add({
    id: `osm-${id}`,
    name,
    category,
    kind: 'osm',
    source: 'OpenStreetMap · OpenFreeMap',
    description,
    osm: {
      layer: match.layer ?? 'poi',
      class: match.class ?? null,
      subclass: match.subclass ?? null,
      where: match.where ?? null,
      minZoom: match.minZoom ?? 14,
    },
    geometry: spec.geometry ?? 'point',
    maxAltitudeM: spec.maxAltitudeM ?? OSM_MAX_ALT,
    style: { label: 'name', ...(spec.style ?? {}) },
    info: spec.info ?? {
      title: 'name',
      fields: [
        ['Type', 'subclass', 'text'],
        ['Class', 'class', 'text'],
      ],
    },
    statsBy: spec.statsBy ?? 'subclass',
    tags: spec.tags ?? '',
  });
}

function computed(id, name, category, compute, description, spec = {}) {
  add({
    id,
    name,
    category,
    kind: 'computed',
    source: spec.source ?? 'Computed in browser',
    description,
    computed: compute,
    params: spec.params ?? {},
    geometry: spec.geometry ?? 'line',
    refreshMs: spec.refreshMs ?? null,
    dynamic: spec.dynamic ?? false,
    style: spec.style ?? {},
    info: spec.info ?? { title: 'name', fields: [] },
    tags: spec.tags ?? '',
  });
}

const ALERT_COLORS = {
  Green: '#3ddc84',
  Orange: '#ffa726',
  Red: '#ff3b3b',
  green: '#3ddc84',
  yellow: '#ffe14d',
  orange: '#ffa726',
  red: '#ff3b3b',
};
const quakeInfo = {
  title: 'name',
  fields: [
    ['Magnitude', 'magnitude', 'num:1'],
    ['Time', 'time', 'time'],
    ['PAGER alert', 'alert', 'text'],
    ['Tsunami flag', 'tsunami', 'int'],
    ['Significance', 'significance', 'int'],
    ['Details', 'link', 'link'],
  ],
};
const quakeStyle = (color) => ({
  color,
  sizeBy: { prop: 'magnitude', domain: [2.5, 8], range: [5, 20] },
  colorBy: { prop: 'alert', map: ALERT_COLORS },
  label: 'name',
  labelMax: 25,
});

// ═══ HAZARDS & DISASTERS ═════════════════════════════════════════════════

const EONET = [
  [
    'wildfires',
    'Wildfires',
    '#ff5a1f',
    'Open wildfire events tracked by NASA’s Earth Observatory Natural Event Tracker (last 60 days).',
  ],
  [
    'severeStorms',
    'Severe Storms',
    '#5fb4ff',
    'Tropical cyclones and severe storm systems currently tracked by NASA EONET.',
  ],
  [
    'volcanoes',
    'Volcanic Activity',
    '#ff3b3b',
    'Volcanoes with open eruption or unrest events in NASA EONET.',
  ],
  ['floods', 'Floods', '#2f80ff', 'Flood events currently open in NASA EONET.'],
  [
    'seaLakeIce',
    'Icebergs & Lake Ice',
    '#cfeaff',
    'Tracked icebergs and notable sea/lake ice events (NASA EONET).',
  ],
  [
    'dustHaze',
    'Dust & Haze',
    '#d9b26f',
    'Dust storms, haze and smoke plumes (NASA EONET).',
  ],
  ['drought', 'Drought', '#c98a3a', 'Drought events (NASA EONET).'],
  ['landslides', 'Landslides', '#9b6b43', 'Landslide events (NASA EONET).'],
  ['snow', 'Extreme Snow', '#ffffff', 'Major snow events (NASA EONET).'],
  [
    'tempExtremes',
    'Temperature Extremes',
    '#ff7aa2',
    'Heat waves and cold extremes (NASA EONET).',
  ],
  [
    'waterColor',
    'Water Color Events',
    '#3be0b0',
    'Algal blooms, sediment and water-color anomalies (NASA EONET).',
  ],
  [
    'manmade',
    'Man-made Events',
    '#b0b8c4',
    'Notable man-made events such as industrial fires and spills (NASA EONET).',
  ],
  [
    'earthquakes',
    'Earthquakes',
    '#ffd166',
    'Earthquake events curated in NASA EONET.',
  ],
];
for (const [cat, name, color, description] of EONET) {
  feed(
    `eonet-${cat.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
    `${name} · EONET`,
    'hazards',
    'NASA EONET',
    description,
    {
      feed: `eonet-${cat}`,
      refreshMs: 15 * MIN,
      geometry: 'auto',
      style: { color, size: 9, label: 'title', labelMax: 30, fill: 0.2 },
      info: {
        title: 'title',
        fields: [
          ['Date', 'date', 'time'],
          ['Magnitude', 'magnitude', 'num:1'],
          ['Unit', 'unit', 'text'],
          ['Source', 'source', 'link'],
          ['EONET', 'link', 'link'],
        ],
      },
      tags: 'nasa natural events',
    },
  );
}

const GDACS = [
  [
    'earthquakes',
    'Earthquake Alerts',
    'Earthquakes with humanitarian-impact alert levels (green/orange/red) from GDACS.',
  ],
  [
    'cyclones',
    'Tropical Cyclone Alerts',
    'Tropical cyclones scored for population exposure by GDACS.',
  ],
  ['floods', 'Flood Alerts', 'Major floods with GDACS alert levels.'],
  [
    'volcanoes',
    'Volcano Alerts',
    'Volcanic eruptions assessed by GDACS (last 60 days).',
  ],
  ['droughts', 'Drought Alerts', 'Droughts assessed by GDACS (last 60 days).'],
  ['wildfires', 'Wildfire Alerts', 'Large forest fires assessed by GDACS.'],
];
for (const [slug, name, description] of GDACS) {
  feed(`gdacs-${slug}`, `${name} · GDACS`, 'hazards', 'GDACS', description, {
    refreshMs: 15 * MIN,
    style: {
      color: '#ffa726',
      size: 11,
      colorBy: { prop: 'alert', map: ALERT_COLORS },
      label: 'name',
      labelMax: 30,
    },
    info: {
      title: 'name',
      fields: [
        ['Alert level', 'alert', 'text'],
        ['Alert score', 'score', 'num:1'],
        ['Severity', 'severity', 'text'],
        ['Country', 'country', 'text'],
        ['From', 'from', 'time'],
        ['To', 'to', 'time'],
        ['Report', 'link', 'link'],
      ],
    },
    statsBy: 'alert',
    legend: [
      ['Green', '#3ddc84'],
      ['Orange', '#ffa726'],
      ['Red', '#ff3b3b'],
    ],
    tags: 'un humanitarian',
  });
}

feed(
  'usgs-significant-month',
  'Significant Earthquakes · 30 days',
  'hazards',
  'USGS',
  'Earthquakes the USGS rates as significant over the last 30 days (magnitude, felt reports and impact).',
  {
    refreshMs: 10 * MIN,
    style: quakeStyle('#ffd166'),
    info: quakeInfo,
    statsBy: 'alert',
    statsValue: 'magnitude',
  },
);
feed(
  'usgs-m45-week',
  'M4.5+ Earthquakes · 7 days',
  'hazards',
  'USGS',
  'Every magnitude 4.5 and larger earthquake worldwide in the past week.',
  {
    refreshMs: 10 * MIN,
    style: quakeStyle('#ff9f43'),
    info: quakeInfo,
    statsValue: 'magnitude',
  },
);
feed(
  'usgs-m25-week',
  'M2.5+ Earthquakes · 7 days',
  'hazards',
  'USGS',
  'Every magnitude 2.5 and larger earthquake in the past week (global coverage is denser in the US).',
  {
    refreshMs: 10 * MIN,
    style: { ...quakeStyle('#ffbe76'), labelMax: 0 },
    info: quakeInfo,
    statsValue: 'magnitude',
  },
);
feed(
  'usgs-volcano-alerts',
  'US Volcano Alert Levels',
  'hazards',
  'USGS VHP',
  'US volcanoes currently above normal background (advisory, watch or warning) from the USGS Volcano Hazards Program.',
  {
    refreshMs: 30 * MIN,
    style: {
      color: '#ff3b3b',
      size: 12,
      colorBy: {
        prop: 'color',
        map: {
          GREEN: '#3ddc84',
          YELLOW: '#ffe14d',
          ORANGE: '#ffa726',
          RED: '#ff3b3b',
        },
      },
      label: 'name',
    },
    info: {
      title: 'name',
      fields: [
        ['Alert level', 'alert', 'text'],
        ['Aviation color', 'color', 'text'],
        ['Observatory', 'observatory', 'text'],
        ['Issued', 'sent', 'time'],
        ['Synopsis', 'synopsis', 'text'],
        ['Notice', 'link', 'link'],
      ],
    },
    statsBy: 'alert',
  },
);
feed(
  'gvp-holocene-volcanoes',
  'Holocene Volcanoes',
  'hazards',
  'Smithsonian GVP',
  'All ~1,300 volcanoes active in the last 12,000 years, with type and last known eruption (Smithsonian Global Volcanism Program).',
  {
    style: {
      color: '#ff6b3d',
      size: 6,
      colorBy: {
        prop: 'last_eruption',
        stops: [
          [-10000, '#7a5a4a'],
          [1500, '#c9733f'],
          [1900, '#ff7b3d'],
          [2000, '#ff3b3b'],
        ],
      },
      label: 'name',
      labelMax: 40,
    },
    info: {
      title: 'name',
      fields: [
        ['Type', 'type', 'text'],
        ['Last eruption (year)', 'last_eruption', 'int'],
        ['Country', 'country', 'text'],
        ['Elevation', 'elevation', 'm'],
        ['Tectonic setting', 'setting', 'text'],
        ['GVP profile', 'link', 'link'],
      ],
    },
    statsBy: 'type',
  },
);
feed(
  'ncei-tsunamis',
  'Historical Tsunamis · since 1950',
  'hazards',
  'NOAA NCEI',
  'Tsunami source events since 1950 from the NOAA NCEI Global Historical Tsunami Database.',
  {
    style: {
      color: '#2fd1c5',
      sizeBy: { prop: 'max_water_m', domain: [0, 30], range: [5, 18] },
      label: 'name',
      labelMax: 20,
    },
    info: {
      title: 'name',
      fields: [
        ['Date', 'date', 'text'],
        ['Earthquake magnitude', 'magnitude', 'num:1'],
        ['Max water height', 'max_water_m', 'm'],
        ['Run-ups', 'runups', 'int'],
        ['Deaths', 'deaths', 'int'],
        ['Country', 'country', 'text'],
      ],
    },
    statsBy: 'country',
    statsValue: 'max_water_m',
  },
);
feed(
  'ncei-earthquakes',
  'Deadly & Damaging Earthquakes · since 1990',
  'hazards',
  'NOAA NCEI',
  'Significant earthquakes since 1990 (deaths, damage or magnitude 7.5+) from the NOAA NCEI database.',
  {
    style: {
      color: '#ff7043',
      sizeBy: { prop: 'magnitude', domain: [5, 9.5], range: [5, 20] },
      label: 'name',
      labelMax: 20,
    },
    info: {
      title: 'name',
      fields: [
        ['Date', 'date', 'text'],
        ['Magnitude', 'magnitude', 'num:1'],
        ['Depth', 'depth_km', 'km'],
        ['Deaths', 'deaths', 'int'],
        ['Damage ($M)', 'damage_musd', 'num:0'],
        ['Country', 'country', 'text'],
      ],
    },
    statsBy: 'country',
    statsValue: 'magnitude',
  },
);
feed(
  'ncei-eruptions',
  'Significant Eruptions · since 1800',
  'hazards',
  'NOAA NCEI',
  'Significant volcanic eruptions since 1800 (fatalities, damage, VEI ≥ 6 or tsunami) from NOAA NCEI.',
  {
    style: {
      color: '#ff3b3b',
      sizeBy: { prop: 'vei', domain: [0, 7], range: [5, 18] },
      label: 'name',
      labelMax: 20,
    },
    info: {
      title: 'name',
      fields: [
        ['Date', 'date', 'text'],
        ['VEI', 'vei', 'int'],
        ['Type', 'type', 'text'],
        ['Elevation', 'elevation', 'm'],
        ['Deaths', 'deaths', 'int'],
        ['Country', 'country', 'text'],
      ],
    },
    statsBy: 'country',
  },
);
feed(
  'nwps-flood-gauges',
  'River Gauges in Flood',
  'hazards',
  'NOAA NWPS',
  'US river gauges currently at or forecast to reach action, minor, moderate or major flood stage.',
  {
    refreshMs: 20 * MIN,
    style: {
      color: '#2f80ff',
      size: 8,
      colorBy: {
        prop: 'category',
        map: {
          action: '#ffe14d',
          minor: '#ffa726',
          moderate: '#ff3b3b',
          major: '#c74dff',
        },
      },
      label: 'name',
      labelMax: 30,
    },
    info: {
      title: 'name',
      fields: [
        ['Flood category', 'category', 'text'],
        ['Observed', 'observed', 'text'],
        ['Forecast', 'forecast', 'text'],
        ['Stage', 'stage', 'num:2'],
        ['Unit', 'unit', 'text'],
        ['State', 'state', 'text'],
        ['Hydrograph', 'link', 'link'],
      ],
    },
    statsBy: 'category',
    legend: [
      ['Action', '#ffe14d'],
      ['Minor', '#ffa726'],
      ['Moderate', '#ff3b3b'],
      ['Major', '#c74dff'],
    ],
  },
);
feed(
  'plates-boundaries',
  'Tectonic Plate Boundaries',
  'hazards',
  'Bird (2003) PB2002',
  'Global plate boundaries (ridges, trenches and transforms) from Peter Bird’s PB2002 model.',
  {
    geometry: 'line',
    style: { color: '#ff4d4d', width: 2 },
    info: {
      title: 'name',
      fields: [
        ['Plate A', 'plate_a', 'text'],
        ['Plate B', 'plate_b', 'text'],
        ['Type', 'type', 'text'],
      ],
    },
    tags: 'geology faults',
  },
);
feed(
  'plates-orogens',
  'Orogens (Deforming Zones)',
  'hazards',
  'Bird (2003) PB2002',
  'Broad zones of active mountain building and crustal deformation (PB2002).',
  {
    geometry: 'polygon',
    style: { color: '#ff9f43', width: 1.5, fill: 0.18 },
    tags: 'geology',
  },
);

// ═══ WEATHER & STORMS ════════════════════════════════════════════════════

const NWS = [
  ['tornado', 'Tornado Warnings & Watches', '#ff2d55'],
  ['severe-thunderstorm', 'Severe Thunderstorm Alerts', '#ffb020'],
  ['flood', 'Flood & Flash Flood Alerts', '#2fd36b'],
  ['coastal', 'Coastal, Surf & Rip Current Alerts', '#2fd1c5'],
  ['winter', 'Winter & Cold Alerts', '#9fd3ff'],
  ['heat', 'Heat Alerts', '#ff6f61'],
  ['fire', 'Red Flag & Fire Weather', '#ff3b8d'],
  ['wind', 'Wind & Dust Alerts', '#d2b48c'],
  ['marine', 'Marine Alerts', '#7a9cff'],
  ['tropical', 'Tropical Storm & Hurricane Alerts', '#e040fb'],
  ['all', 'All NWS Alerts (storm-based)', '#ffffff'],
];
for (const [slug, name, color] of NWS) {
  feed(
    `nws-${slug}`,
    name,
    'weather',
    'NOAA NWS',
    `${name} currently in effect in the United States. Drawn from the storm-based warning polygons; zone-only alerts have no polygon and are not drawn.`,
    {
      refreshMs: 3 * MIN,
      geometry: 'polygon',
      style: { color, width: 2, fill: 0.22 },
      info: {
        title: 'headline',
        fields: [
          ['Event', 'event', 'text'],
          ['Severity', 'severity', 'text'],
          ['Urgency', 'urgency', 'text'],
          ['Area', 'area', 'text'],
          ['Expires', 'expires', 'time'],
          ['Issued by', 'sender', 'text'],
        ],
      },
      statsBy: 'event',
      tags: 'warnings united states',
    },
  );
}

const SPC = [
  ['spc-day1-categorical', 'Severe Outlook · Day 1'],
  ['spc-day1-tornado', 'Tornado Probability · Day 1'],
  ['spc-day1-hail', 'Hail Probability · Day 1'],
  ['spc-day1-wind', 'Damaging Wind Probability · Day 1'],
  ['spc-day2-categorical', 'Severe Outlook · Day 2'],
  ['spc-day3-categorical', 'Severe Outlook · Day 3'],
];
for (const [id, name] of SPC) {
  feed(
    id,
    name,
    'weather',
    'NOAA SPC',
    `${name} from the NOAA Storm Prediction Center convective outlook, colored with SPC’s own risk palette.`,
    {
      refreshMs: 15 * MIN,
      geometry: 'polygon',
      style: {
        color: '#66a366',
        width: 1.5,
        fill: 0.3,
        colorBy: { prop: 'fill', direct: true },
      },
      info: {
        title: 'name',
        fields: [
          ['Risk', 'label', 'text'],
          ['Valid', 'valid', 'text'],
          ['Expires', 'expires', 'text'],
        ],
      },
      statsBy: 'label',
      tags: 'convective tornado',
    },
  );
}

feed(
  'awc-sigmets',
  'SIGMETs & AIRMETs (US)',
  'weather',
  'NOAA AWC',
  'Domestic SIGMETs and convective SIGMETs: hazardous weather for aircraft (convection, turbulence, icing, IFR).',
  {
    refreshMs: 5 * MIN,
    geometry: 'polygon',
    style: {
      color: '#ff9f43',
      width: 2,
      fill: 0.15,
      colorBy: {
        prop: 'hazard',
        map: {
          CONVECTIVE: '#ff3b3b',
          TURB: '#ffa726',
          ICE: '#7ad7ff',
          IFR: '#b48cff',
          MTN_OBSCN: '#c9a26f',
          ASH: '#9e9e9e',
        },
      },
    },
    info: {
      title: 'hazard',
      fields: [
        ['Type', 'type', 'text'],
        ['Severity', 'severity', 'int'],
        ['Valid from', 'from', 'time'],
        ['Valid to', 'to', 'time'],
        ['Top (ft)', 'top_ft', 'int'],
        ['Raw', 'raw', 'text'],
      ],
    },
    statsBy: 'hazard',
  },
);
feed(
  'awc-intl-sigmets',
  'International SIGMETs',
  'weather',
  'NOAA AWC',
  'Worldwide SIGMETs issued by flight information regions: thunderstorms, turbulence, icing, volcanic ash and tropical cyclones.',
  {
    refreshMs: 5 * MIN,
    geometry: 'polygon',
    style: {
      color: '#ffa726',
      width: 2,
      fill: 0.14,
      colorBy: {
        prop: 'hazard',
        map: {
          TS: '#ff3b3b',
          TURB: '#ffa726',
          ICE: '#7ad7ff',
          VA: '#9e9e9e',
          TC: '#e040fb',
          MTW: '#c9a26f',
        },
      },
    },
    info: {
      title: 'name',
      fields: [
        ['Hazard', 'hazard', 'text'],
        ['Qualifier', 'qualifier', 'text'],
        ['Valid from', 'from', 'time'],
        ['Valid to', 'to', 'time'],
        ['Top (ft)', 'top_ft', 'int'],
        ['Raw', 'raw', 'text'],
      ],
    },
    statsBy: 'hazard',
  },
);
feed(
  'awc-metars',
  'METAR Flight Categories',
  'weather',
  'NOAA AWC',
  'Latest airport weather observations colored by flight category (VFR / MVFR / IFR / LIFR). Loads for the area in view.',
  {
    query: 'bbox',
    maxSpanDeg: 8,
    maxAltitudeM: 900_000,
    refreshMs: 5 * MIN,
    style: {
      color: '#3ddc84',
      size: 8,
      colorBy: {
        prop: 'category',
        map: {
          VFR: '#3ddc84',
          MVFR: '#4da3ff',
          IFR: '#ff3b3b',
          LIFR: '#e040fb',
        },
      },
      label: 'name',
    },
    info: {
      title: 'name',
      fields: [
        ['Station', 'site', 'text'],
        ['Flight category', 'category', 'text'],
        ['Temperature (°C)', 'temp_c', 'num:0'],
        ['Wind (kt)', 'wind_kt', 'int'],
        ['Gust (kt)', 'gust_kt', 'int'],
        ['Visibility (sm)', 'visibility', 'text'],
        ['Observed', 'time', 'time'],
        ['Raw', 'raw', 'text'],
      ],
    },
    statsBy: 'category',
    legend: [
      ['VFR', '#3ddc84'],
      ['MVFR', '#4da3ff'],
      ['IFR', '#ff3b3b'],
      ['LIFR', '#e040fb'],
    ],
    tags: 'airport weather aviation',
  },
);
feed(
  'awc-pireps',
  'Pilot Reports (PIREPs)',
  'weather',
  'NOAA AWC',
  'Pilot reports of turbulence, icing and weather from the last 3 hours, for the area in view.',
  {
    query: 'bbox',
    maxSpanDeg: 30,
    maxAltitudeM: 3_000_000,
    refreshMs: 5 * MIN,
    style: { color: '#ffd166', size: 7, label: 'aircraft', labelMax: 20 },
    info: {
      title: 'type',
      fields: [
        ['Aircraft', 'aircraft', 'text'],
        ['Flight level', 'flight_level', 'int'],
        ['Turbulence', 'turbulence', 'text'],
        ['Icing', 'icing', 'text'],
        ['Observed', 'time', 'time'],
        ['Raw', 'raw', 'text'],
      ],
    },
    statsBy: 'type',
    tags: 'turbulence icing',
  },
);
feed(
  'ndbc-buoys',
  'Ocean Buoys & C-MAN Stations',
  'weather',
  'NOAA NDBC',
  'Latest observations from moored buoys and coastal stations: wind, waves, pressure and water temperature.',
  {
    refreshMs: 15 * MIN,
    style: {
      color: '#ffe14d',
      sizeBy: { prop: 'wave_m', domain: [0, 8], range: [5, 14] },
      label: 'name',
      labelMax: 20,
    },
    info: {
      title: 'name',
      fields: [
        ['Observed', 'time', 'time'],
        ['Wind (m/s)', 'wind_ms', 'num:1'],
        ['Gust (m/s)', 'gust_ms', 'num:1'],
        ['Wind dir (°)', 'wind_dir', 'int'],
        ['Wave height (m)', 'wave_m', 'num:1'],
        ['Dominant period (s)', 'period_s', 'num:0'],
        ['Pressure (hPa)', 'pressure', 'num:1'],
        ['Air (°C)', 'air_c', 'num:1'],
        ['Water (°C)', 'water_c', 'num:1'],
      ],
    },
    statsValue: 'wave_m',
    tags: 'marine waves',
  },
);
feed(
  'sensor-community-temperature',
  'Citizen Temperature Sensors',
  'weather',
  'Sensor.Community',
  'Outdoor temperature from thousands of citizen-science sensors (mostly Europe).',
  {
    refreshMs: 10 * MIN,
    style: {
      color: '#ffa726',
      size: 5,
      colorBy: {
        prop: 'temp',
        stops: [
          [-20, '#5e3cff'],
          [0, '#4da3ff'],
          [10, '#3ddc84'],
          [20, '#ffe14d'],
          [30, '#ff7043'],
          [40, '#d50000'],
        ],
      },
    },
    info: {
      title: 'id',
      fields: [
        ['Temperature (°C)', 'temp', 'num:1'],
        ['Humidity (%)', 'humidity', 'num:0'],
        ['Country', 'country', 'text'],
        ['Updated', 'time', 'time'],
      ],
    },
    statsBy: 'country',
    statsValue: 'temp',
    legend: [
      ['−20 °C', '#5e3cff'],
      ['0', '#4da3ff'],
      ['10', '#3ddc84'],
      ['20', '#ffe14d'],
      ['30', '#ff7043'],
      ['40', '#d50000'],
    ],
  },
);
gibs(
  'imerg-precip',
  'Precipitation Rate (IMERG)',
  'weather',
  'IMERG_Precipitation_Rate',
  'Satellite-estimated rain and snow rate from NASA GPM IMERG (near real time).',
  { alpha: 0.7, maxLevel: 6 },
);
gibs(
  'goes-east-geocolor',
  'GOES-East GeoColor',
  'weather',
  'GOES-East_ABI_GeoColor',
  'Near-live GeoColor imagery of the Americas and Atlantic from GOES-East (10-minute cadence).',
  { alpha: 0.85, maxLevel: 7 },
);
gibs(
  'goes-west-geocolor',
  'GOES-West GeoColor',
  'weather',
  'GOES-West_ABI_GeoColor',
  'Near-live GeoColor imagery of the Pacific and western Americas from GOES-West.',
  { alpha: 0.85, maxLevel: 7 },
);
gibs(
  'goes-east-ir',
  'GOES-East Infrared (Band 13)',
  'weather',
  'GOES-East_ABI_Band13_Clean_Infrared',
  'Clean longwave infrared: cloud-top temperatures day and night over the Americas.',
  { alpha: 0.8, maxLevel: 7 },
);
gibs(
  'goes-east-airmass',
  'GOES-East Air Mass RGB',
  'weather',
  'GOES-East_ABI_Air_Mass',
  'Air Mass RGB: jet streaks, dry intrusions and storm development.',
  { alpha: 0.8, maxLevel: 7 },
);
gibs(
  'himawari-ir',
  'Himawari Infrared (Band 13)',
  'weather',
  'Himawari_AHI_Band13_Clean_Infrared',
  'Clean infrared from Japan’s Himawari over Asia and the western Pacific.',
  { alpha: 0.8, maxLevel: 7 },
);
gibs(
  'cloud-top-temp',
  'Cloud Top Temperature',
  'weather',
  'MODIS_Terra_Cloud_Top_Temp_Day',
  'Daytime cloud-top temperature from MODIS Terra.',
  { maxLevel: 6 },
);
gibs(
  'cloud-fraction',
  'Cloud Fraction',
  'weather',
  'MODIS_Terra_Cloud_Fraction_Day',
  'Fraction of each area covered by cloud (MODIS Terra, daytime).',
  { maxLevel: 6 },
);
gibs(
  'water-vapor',
  'Water Vapor',
  'weather',
  'MODIS_Terra_Water_Vapor_5km_Day',
  'Total column water vapor (MODIS Terra, daytime).',
  { maxLevel: 6 },
);
gibs(
  'air-temp-monthly',
  'Surface Air Temperature (monthly)',
  'weather',
  'MERRA2_2m_Air_Temperature_Monthly',
  'Monthly mean 2 m air temperature from the MERRA-2 reanalysis.',
  { maxLevel: 5 },
);

// ═══ AIR QUALITY & ATMOSPHERE ════════════════════════════════════════════

const PM25_STOPS = [
  [0, '#3ddc84'],
  [12, '#ffe14d'],
  [35, '#ffa726'],
  [55, '#ff3b3b'],
  [150, '#b0006d'],
  [250, '#6a0032'],
];
feed(
  'sensor-community-pm25',
  'PM2.5 Air Quality (citizen sensors)',
  'atmosphere',
  'Sensor.Community',
  'Fine particulate matter (PM2.5, µg/m³) from ~10,000 citizen sensors, colored by US EPA breakpoints.',
  {
    feed: 'sensor-community-dust',
    refreshMs: 10 * MIN,
    style: {
      color: '#3ddc84',
      size: 5,
      colorBy: { prop: 'pm25', stops: PM25_STOPS },
      filterProp: 'pm25',
    },
    info: {
      title: 'id',
      fields: [
        ['PM2.5 (µg/m³)', 'pm25', 'num:1'],
        ['PM10 (µg/m³)', 'pm10', 'num:1'],
        ['Country', 'country', 'text'],
        ['Updated', 'time', 'time'],
      ],
    },
    statsBy: 'country',
    statsValue: 'pm25',
    legend: [
      ['Good', '#3ddc84'],
      ['Moderate', '#ffe14d'],
      ['USG', '#ffa726'],
      ['Unhealthy', '#ff3b3b'],
      ['Very unhealthy', '#b0006d'],
    ],
    tags: 'pollution aqi',
  },
);
feed(
  'sensor-community-pm10',
  'PM10 Air Quality (citizen sensors)',
  'atmosphere',
  'Sensor.Community',
  'Coarse particulate matter (PM10, µg/m³) from citizen sensors.',
  {
    feed: 'sensor-community-dust',
    refreshMs: 10 * MIN,
    style: {
      color: '#3ddc84',
      size: 5,
      colorBy: {
        prop: 'pm10',
        stops: [
          [0, '#3ddc84'],
          [55, '#ffe14d'],
          [155, '#ffa726'],
          [255, '#ff3b3b'],
          [355, '#b0006d'],
        ],
      },
      filterProp: 'pm10',
    },
    info: {
      title: 'id',
      fields: [
        ['PM10 (µg/m³)', 'pm10', 'num:1'],
        ['PM2.5 (µg/m³)', 'pm25', 'num:1'],
        ['Country', 'country', 'text'],
        ['Updated', 'time', 'time'],
      ],
    },
    statsBy: 'country',
    statsValue: 'pm10',
    tags: 'pollution aqi',
  },
);
gibs(
  'aod',
  'Aerosol Optical Depth',
  'atmosphere',
  'MODIS_Combined_Value_Added_AOD',
  'Haze, smoke and dust loading from combined MODIS Terra/Aqua aerosol retrievals.',
  { maxLevel: 6 },
);
gibs(
  'aerosol-index',
  'UV Aerosol Index',
  'atmosphere',
  'OMPS_Aerosol_Index',
  'Absorbing aerosols (smoke and dust) detected by OMPS, works over clouds.',
  { maxLevel: 6 },
);
gibs(
  'no2-tropomi',
  'Nitrogen Dioxide (TROPOMI)',
  'atmosphere',
  'TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column',
  'Tropospheric NO₂ from Sentinel-5P TROPOMI: traffic, power plants and industry hot spots.',
  { maxLevel: 7 },
);
gibs(
  'no2-omi',
  'Nitrogen Dioxide (OMI)',
  'atmosphere',
  'OMI_Nitrogen_Dioxide_Tropo_Column',
  'Tropospheric NO₂ from the Aura OMI instrument.',
  { maxLevel: 6 },
);
gibs(
  'co',
  'Carbon Monoxide (MOPITT)',
  'atmosphere',
  'MOPITT_CO_Daily_Total_Column_Day',
  'Total-column carbon monoxide: wildfire and combustion plumes.',
  { maxLevel: 6 },
);
gibs(
  'so2',
  'Sulfur Dioxide',
  'atmosphere',
  'OMI_SO2_Planetary_Boundary_Layer',
  'Near-surface SO₂ from OMI: volcanoes, smelters and coal plants.',
  { maxLevel: 6 },
);
gibs(
  'ozone',
  'Total Ozone',
  'atmosphere',
  'OMPS_Ozone_Total_Column',
  'Total ozone column (Dobson units) from OMPS; shows the ozone hole in season.',
  { maxLevel: 6 },
);
gibs(
  'dust',
  'Dust Score (AIRS)',
  'atmosphere',
  'AIRS_L2_Dust_Score_Day',
  'Airborne dust detected by the AIRS infrared sounder.',
  { maxLevel: 6 },
);

// ═══ OCEANS, ICE & WATER ═════════════════════════════════════════════════

gibs(
  'sst',
  'Sea Surface Temperature',
  'oceans',
  'GHRSST_L4_MUR_Sea_Surface_Temperature',
  'Gap-free 1 km sea surface temperature (GHRSST MUR analysis).',
  { maxLevel: 7 },
);
gibs(
  'sst-anomaly',
  'Sea Surface Temp. Anomaly',
  'oceans',
  'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies',
  'How much warmer or colder the ocean is than normal (marine heat waves, El Niño).',
  { maxLevel: 6 },
);
gibs(
  'chlorophyll',
  'Chlorophyll-a',
  'oceans',
  'MODIS_Aqua_L2_Chlorophyll_A',
  'Ocean chlorophyll concentration: phytoplankton blooms and productive waters.',
  { maxLevel: 7 },
);
gibs(
  'sea-ice',
  'Sea Ice (MODIS)',
  'oceans',
  'MODIS_Terra_Sea_Ice',
  'Daily sea-ice extent from MODIS Terra.',
  { maxLevel: 6 },
);
gibs(
  'ice-surface-temp',
  'Ice Surface Temperature',
  'oceans',
  'VIIRS_SNPP_Ice_Surface_Temp_Day',
  'Surface temperature of sea ice and ice sheets (VIIRS).',
  { maxLevel: 6 },
);
gibs(
  'grace-water',
  'Groundwater & Ice Mass (GRACE)',
  'oceans',
  'GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI',
  'Monthly water-mass change (aquifers, ice sheets) from the GRACE / GRACE-FO gravity missions.',
  { maxLevel: 4 },
);
tiles(
  'openseamap-seamarks',
  'Sea Marks (OpenSeaMap)',
  'oceans',
  'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
  'OpenSeaMap',
  'Buoys, beacons, lights and harbour details from OpenSeaMap (CC BY-SA).',
  { minLevel: 9 },
);
tiles(
  'esri-ocean-reference',
  'Ocean Names & Bathymetry Labels',
  'oceans',
  `${ESRI}Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`,
  'Esri',
  'Undersea feature names (trenches, ridges, seamounts) and ocean labels from Esri.',
  { maxLevel: 13 },
);
feed(
  'coops-tide-stations',
  'Tide Gauges (NOAA CO-OPS)',
  'oceans',
  'NOAA CO-OPS',
  'NOAA water-level stations with links to live tide and water-level data.',
  {
    style: { color: '#2fd1c5', size: 6, label: 'name', labelMax: 30 },
    info: {
      title: 'name',
      fields: [
        ['Station ID', 'id', 'text'],
        ['State', 'state', 'text'],
        ['Live data', 'link', 'link'],
      ],
    },
    statsBy: 'state',
  },
);
feed(
  'ne-reefs',
  'Coral Reefs',
  'oceans',
  'Natural Earth',
  'Major coral reef systems worldwide.',
  { geometry: 'line', style: { color: '#ff7aa2', width: 2 } },
);
feed(
  'ne-glaciers',
  'Glaciers & Ice Caps',
  'oceans',
  'Natural Earth',
  'Glaciated areas and ice caps.',
  { geometry: 'polygon', style: { color: '#d6f1ff', width: 1, fill: 0.35 } },
);
feed(
  'ne-ice-shelves',
  'Antarctic Ice Shelves',
  'oceans',
  'Natural Earth',
  'Floating Antarctic ice shelves.',
  { geometry: 'polygon', style: { color: '#b3e5fc', width: 1, fill: 0.35 } },
);
feed(
  'ne-continental-shelf',
  'Continental Shelf (200 m)',
  'oceans',
  'Natural Earth',
  'Shallow seas less than 200 m deep: the continental shelves.',
  { geometry: 'polygon', style: { color: '#4dd0e1', width: 1, fill: 0.16 } },
);
feed(
  'ne-abyssal-6000',
  'Ocean Deeps (6,000 m+)',
  'oceans',
  'Natural Earth',
  'Abyssal basins and trenches deeper than 6,000 m.',
  { geometry: 'polygon', style: { color: '#3949ab', width: 1, fill: 0.3 } },
);
feed(
  'ne-marine-areas',
  'Seas, Gulfs & Straits',
  'oceans',
  'Natural Earth',
  'Named seas, bays, gulfs, sounds and straits.',
  {
    geometry: 'polygon',
    style: {
      color: '#64b5f6',
      width: 1,
      fill: 0.06,
      label: 'name',
      labelMax: 120,
    },
    statsBy: 'class',
  },
);
feed(
  'ne-lakes',
  'Major Lakes',
  'oceans',
  'Natural Earth',
  'The world’s larger lakes and reservoirs.',
  {
    geometry: 'polygon',
    style: {
      color: '#4fc3f7',
      width: 1,
      fill: 0.3,
      label: 'name',
      labelMax: 60,
    },
  },
);
feed(
  'ne-rivers',
  'Major Rivers',
  'oceans',
  'Natural Earth',
  'Major rivers and lake centerlines.',
  {
    geometry: 'line',
    style: { color: '#4fc3f7', width: 1.5, label: 'name', labelMax: 60 },
  },
);
osm(
  'waterways',
  'Rivers & Canals (OSM)',
  'oceans',
  { layer: 'waterway', class: ['river', 'canal'], minZoom: 9 },
  'Rivers and canals from OpenStreetMap for the area in view.',
  {
    geometry: 'line',
    maxAltitudeM: 200_000,
    style: { color: '#4fc3f7', width: 2 },
    statsBy: 'class',
  },
);
osm(
  'marinas',
  'Marinas & Docks',
  'oceans',
  { class: ['harbor'] },
  'Marinas and docks from OpenStreetMap.',
  { style: { color: '#2fd1c5' } },
);

// ═══ LAND, TERRAIN & VEGETATION ══════════════════════════════════════════

gibs(
  'ndvi',
  'Vegetation Index (NDVI)',
  'land',
  'MODIS_Terra_NDVI_8Day',
  '8-day vegetation greenness from MODIS Terra: crops, forests, drought stress.',
  { maxLevel: 7 },
);
gibs(
  'land-cover',
  'Land Cover Classes',
  'land',
  'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual',
  'Annual IGBP land-cover classes (forest, cropland, urban, desert…) from MODIS.',
  { maxLevel: 6 },
);
gibs(
  'soil-moisture',
  'Root-Zone Soil Moisture (SMAP)',
  'land',
  'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
  'Root-zone soil moisture from the SMAP mission: drought and flood risk.',
  { maxLevel: 5 },
);
gibs(
  'gpp',
  'Gross Primary Productivity',
  'land',
  'MODIS_Terra_L4_Gross_Primary_Productivity_8Day',
  'Carbon uptake by vegetation (8-day, MODIS).',
  { maxLevel: 6 },
);
gibs(
  'lst-day',
  'Land Surface Temp. (day)',
  'land',
  'MODIS_Terra_Land_Surface_Temp_Day',
  'Daytime land surface temperature (MODIS Terra): urban heat islands and deserts.',
  { maxLevel: 7 },
);
gibs(
  'lst-night',
  'Land Surface Temp. (night)',
  'land',
  'MODIS_Terra_Land_Surface_Temp_Night',
  'Night-time land surface temperature (MODIS Terra).',
  { maxLevel: 7 },
);
gibs(
  'snow-cover',
  'Snow Cover',
  'land',
  'MODIS_Terra_NDSI_Snow_Cover',
  'Daily snow cover (NDSI) from MODIS Terra.',
  { maxLevel: 7 },
);
gibs(
  'snow-water',
  'Snow Water Equivalent',
  'land',
  'AMSRU2_Snow_Water_Equivalent_5Day',
  'Water stored in the snowpack (AMSR2, 5-day).',
  { maxLevel: 5 },
);
gibs(
  'elevation-color',
  'Elevation (color)',
  'land',
  'ASTER_GDEM_Color_Index',
  'Color-coded elevation from the ASTER global DEM.',
  { maxLevel: 9, alpha: 0.6 },
);
gibs(
  'hillshade-aster',
  'Shaded Relief (ASTER)',
  'land',
  'ASTER_GDEM_Greyscale_Shaded_Relief',
  'Greyscale shaded relief from the ASTER global DEM.',
  { maxLevel: 10, alpha: 0.5 },
);
tiles(
  'esri-hillshade',
  'World Hillshade (Esri)',
  'land',
  `${ESRI}Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`,
  'Esri',
  'High-resolution multidirectional hillshade from Esri.',
  { alpha: 0.45, maxLevel: 16 },
);
tiles(
  'opentopomap',
  'Topographic Map (OpenTopoMap)',
  'land',
  'https://tile.opentopomap.org/{z}/{x}/{y}.png',
  'OpenTopoMap',
  'Contour lines, hill shading and trails (OpenTopoMap, CC BY-SA). Fair-use tile server: keep zoomed views light.',
  { alpha: 0.75, maxLevel: 17 },
);
tiles(
  'usgs-topo',
  'USGS Topo (US)',
  'land',
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
  'USGS',
  'USGS National Map topographic base (United States).',
  { alpha: 0.75, maxLevel: 16 },
);
tiles(
  'usgs-hydro',
  'USGS Hydrography (US)',
  'land',
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}',
  'USGS',
  'Streams, rivers and water bodies from the USGS National Hydrography Dataset.',
  { alpha: 0.85, maxLevel: 16 },
);
feed(
  'ne-highest-points',
  'Notable Peaks & Elevations',
  'land',
  'Natural Earth',
  'Named mountain peaks, passes and depressions worldwide with elevation.',
  {
    style: { color: '#e0e0e0', size: 6, label: 'name', labelMax: 80 },
    info: {
      title: 'name',
      fields: [
        ['Elevation', 'elevation', 'm'],
        ['Type', 'class', 'text'],
        ['Region', 'region', 'text'],
      ],
    },
    statsBy: 'class',
    statsValue: 'elevation',
  },
);
feed(
  'ne-physical-regions',
  'Deserts, Ranges & Plateaus',
  'land',
  'Natural Earth',
  'Labels for physical regions: mountain ranges, deserts, plateaus, plains and basins.',
  {
    style: { color: '#c9a26f', size: 5, label: 'name', labelMax: 120 },
    info: {
      title: 'name',
      fields: [
        ['Type', 'class', 'text'],
        ['Region', 'region', 'text'],
      ],
    },
    statsBy: 'class',
  },
);
feed(
  'ne-playas',
  'Salt Flats & Playas',
  'land',
  'Natural Earth',
  'Dry lake beds and salt flats.',
  {
    geometry: 'polygon',
    style: { color: '#fff3c4', width: 1, fill: 0.35, label: 'name' },
  },
);
osm(
  'peaks',
  'Mountain Peaks (OSM)',
  'land',
  { layer: 'mountain_peak', class: ['peak'], minZoom: 7 },
  'Mountain summits with elevation from OpenStreetMap (most prominent first when zoomed out).',
  {
    maxAltitudeM: 600_000,
    style: { color: '#f5f5f5', size: 6, label: 'name' },
    info: {
      title: 'name',
      fields: [
        ['Elevation', 'ele', 'm'],
        ['Type', 'class', 'text'],
      ],
    },
    statsBy: 'class',
  },
);
osm(
  'volcano-peaks',
  'Volcano Summits (OSM)',
  'land',
  { layer: 'mountain_peak', class: ['volcano'], minZoom: 7 },
  'Volcanic summits mapped in OpenStreetMap.',
  {
    maxAltitudeM: 600_000,
    style: { color: '#ff6b3d', size: 7, label: 'name' },
    info: { title: 'name', fields: [['Elevation', 'ele', 'm']] },
  },
);
osm(
  'saddles',
  'Mountain Passes & Saddles',
  'land',
  { layer: 'mountain_peak', class: ['saddle'], minZoom: 7 },
  'Mountain passes and saddles from OpenStreetMap.',
  {
    maxAltitudeM: 300_000,
    style: { color: '#bdbdbd', size: 5, label: 'name' },
    info: { title: 'name', fields: [['Elevation', 'ele', 'm']] },
  },
);
osm(
  'protected-areas',
  'Parks & Protected Areas (OSM)',
  'land',
  { layer: 'park', minZoom: 6 },
  'National parks, nature reserves and other protected areas from OpenStreetMap.',
  {
    geometry: 'polygon',
    maxAltitudeM: 400_000,
    style: { color: '#66bb6a', width: 1.5, fill: 0.15 },
    statsBy: 'class',
  },
);
osm(
  'quarries',
  'Quarries & Open Pits',
  'land',
  { layer: 'landuse', class: ['quarry'], minZoom: 10 },
  'Quarries and open-pit mines from OpenStreetMap.',
  {
    geometry: 'polygon',
    maxAltitudeM: 120_000,
    style: { color: '#bcaaa4', width: 1.5, fill: 0.3 },
  },
);
feed(
  'ne-us-parks',
  'US National Parks',
  'land',
  'Natural Earth',
  'US national parks, monuments and other NPS units.',
  {
    geometry: 'polygon',
    style: {
      color: '#66bb6a',
      width: 1.5,
      fill: 0.2,
      label: 'name',
      labelMax: 80,
    },
    info: { title: 'name', fields: [['Unit type', 'type', 'text']] },
    statsBy: 'type',
  },
);

// ═══ SATELLITE IMAGERY & NIGHT LIGHTS ════════════════════════════════════

gibs(
  'viirs-truecolor',
  'True Color · VIIRS (yesterday)',
  'imagery',
  'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  'Yesterday’s full-globe true-color mosaic from Suomi NPP VIIRS: smoke, storms, snow and blooms.',
  { time: 'yesterday', alpha: 1, maxLevel: 9 },
);
gibs(
  'noaa20-truecolor',
  'True Color · NOAA-20 (yesterday)',
  'imagery',
  'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
  'Yesterday’s true-color mosaic from NOAA-20 VIIRS.',
  { time: 'yesterday', alpha: 1, maxLevel: 9 },
);
gibs(
  'modis-terra-truecolor',
  'True Color · MODIS Terra (yesterday)',
  'imagery',
  'MODIS_Terra_CorrectedReflectance_TrueColor',
  'Yesterday’s morning-pass true-color mosaic from MODIS Terra.',
  { time: 'yesterday', alpha: 1, maxLevel: 9 },
);
gibs(
  'modis-aqua-truecolor',
  'True Color · MODIS Aqua (yesterday)',
  'imagery',
  'MODIS_Aqua_CorrectedReflectance_TrueColor',
  'Yesterday’s afternoon-pass true-color mosaic from MODIS Aqua.',
  { time: 'yesterday', alpha: 1, maxLevel: 9 },
);
gibs(
  'night-lights-live',
  'Night Lights · last night (VIIRS DNB)',
  'imagery',
  'VIIRS_SNPP_DayNightBand_ENCC',
  'Last night’s lights, fires, fishing fleets and moonlit clouds from the VIIRS Day/Night Band.',
  { time: 'yesterday', alpha: 1, maxLevel: 8 },
);
gibs(
  'black-marble',
  'Black Marble Night Lights',
  'imagery',
  'VIIRS_Black_Marble',
  'NASA Black Marble cloud-free night-lights composite.',
  { alpha: 0.95, maxLevel: 8 },
);
gibs(
  'city-lights-2012',
  'City Lights 2012',
  'imagery',
  'VIIRS_CityLights_2012',
  'The classic 2012 Earth at Night city-lights composite.',
  { alpha: 0.95, maxLevel: 8 },
);
gibs(
  'blue-marble',
  'Blue Marble (relief & bathymetry)',
  'imagery',
  'BlueMarble_ShadedRelief_Bathymetry',
  'NASA Blue Marble with shaded relief and ocean bathymetry.',
  { alpha: 1, maxLevel: 8 },
);
gibs(
  'landsat-weld',
  'Landsat Annual Mosaic',
  'imagery',
  'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual',
  'Cloud-free annual Landsat mosaic (WELD).',
  { alpha: 1, maxLevel: 10 },
);
gibs(
  'thermal-anomalies',
  'Fire Detections (VIIRS 375 m)',
  'imagery',
  'VIIRS_SNPP_Thermal_Anomalies_375m_All',
  'Active fire and thermal-anomaly detections from VIIRS, drawn as imagery.',
  { time: 'yesterday', alpha: 1, maxLevel: 9 },
);
gibs(
  'brightness-temp',
  'Thermal Infrared (MODIS Band 31)',
  'imagery',
  'MODIS_Terra_Brightness_Temp_Band31_Day',
  'Brightness temperature at 11 µm (MODIS Terra).',
  { maxLevel: 6 },
);
gibs(
  'population-density',
  'Population Density 2020',
  'imagery',
  'GPW_Population_Density_2020',
  'Gridded population density from SEDAC GPWv4.',
  { alpha: 0.7, maxLevel: 7 },
);

// ═══ ENERGY & INDUSTRY ═══════════════════════════════════════════════════

const powerInfo = {
  title: 'name',
  fields: [
    ['Fuel', 'fuel', 'text'],
    ['Capacity', 'capacity_mw', 'mw'],
    ['Commissioned', 'year', 'int'],
    ['Owner', 'owner', 'text'],
    ['Country', 'country', 'text'],
  ],
};
const POWER = [
  ['nuclear', 'Nuclear Power Plants', '#c6ff00'],
  ['coal', 'Coal Power Plants', '#8d6e63'],
  ['gas', 'Gas Power Plants', '#ff8a65'],
  ['oil', 'Oil Power Plants', '#a1887f'],
  ['hydro', 'Hydroelectric Plants', '#29b6f6'],
  ['solar', 'Solar Farms', '#ffca28'],
  ['wind', 'Wind Farms', '#80deea'],
  ['geothermal', 'Geothermal Plants', '#ef5350'],
  ['bioenergy', 'Biomass & Waste-to-Energy', '#9ccc65'],
  ['storage', 'Grid Battery Storage', '#ce93d8'],
  ['marine', 'Tidal & Wave Power', '#4db6ac'],
];
for (const [slug, name, color] of POWER) {
  feed(
    `power-${slug}`,
    name,
    'energy',
    'WRI Global Power Plant DB',
    `${name} worldwide, sized by generating capacity (WRI Global Power Plant Database, ~35,000 plants).`,
    {
      feed: `power-${slug}`,
      style: {
        color,
        sizeBy: {
          prop: 'capacity_mw',
          domain: [1, 5000],
          range: [4, 18],
          scale: 'sqrt',
        },
        label: 'name',
        labelMax: 40,
      },
      info: powerInfo,
      statsBy: 'country',
      statsValue: 'capacity_mw',
      tags: 'electricity grid',
    },
  );
}
osm(
  'fuel',
  'Fuel Stations',
  'energy',
  { subclass: ['fuel'] },
  'Petrol and diesel stations from OpenStreetMap.',
  { style: { color: '#ffb020' } },
);
osm(
  'ev-charging',
  'EV Charging Stations',
  'energy',
  { subclass: ['charging_station'] },
  'Electric-vehicle charging stations from OpenStreetMap.',
  { style: { color: '#00e676' } },
);
osm(
  'industrial',
  'Industrial Zones',
  'energy',
  { layer: 'landuse', class: ['industrial'], minZoom: 11 },
  'Industrial land use from OpenStreetMap.',
  {
    geometry: 'polygon',
    maxAltitudeM: 80_000,
    style: { color: '#b39ddb', width: 1, fill: 0.2 },
  },
);
osm(
  'recycling',
  'Recycling Centers',
  'energy',
  { subclass: ['recycling'] },
  'Recycling points and centers from OpenStreetMap.',
  { style: { color: '#66bb6a' } },
);

// ═══ AVIATION ════════════════════════════════════════════════════════════

const airportInfo = {
  title: 'name',
  fields: [
    ['ICAO / ident', 'ident', 'text'],
    ['IATA', 'iata', 'text'],
    ['Type', 'type', 'text'],
    ['City', 'city', 'text'],
    ['Country', 'country', 'text'],
    ['Elevation', 'elevation_ft', 'ft'],
    ['Scheduled service', 'scheduled', 'text'],
    ['More', 'link', 'link'],
  ],
};
feed(
  'oa-airports-large',
  'Major Airports',
  'aviation',
  'OurAirports',
  'Large commercial airports worldwide (OurAirports).',
  {
    style: { color: '#7ad7ff', size: 9, label: 'iata', labelMax: 120 },
    info: airportInfo,
    statsBy: 'country',
  },
);
feed(
  'oa-airports-medium',
  'Regional Airports',
  'aviation',
  'OurAirports',
  'Medium airports with regional or scheduled service.',
  {
    style: { color: '#4fc3f7', size: 6, label: 'ident', labelMax: 60 },
    info: airportInfo,
    statsBy: 'country',
  },
);
feed(
  'oa-airports-small',
  'Small Airfields',
  'aviation',
  'OurAirports',
  'About 43,000 small airports and airstrips.',
  {
    style: { color: '#90a4ae', size: 4 },
    info: airportInfo,
    statsBy: 'country',
  },
);
feed(
  'oa-heliports',
  'Heliports',
  'aviation',
  'OurAirports',
  'About 23,000 heliports and helipads (hospitals, offshore platforms, police).',
  {
    style: { color: '#ba68c8', size: 4 },
    info: airportInfo,
    statsBy: 'country',
  },
);
feed(
  'oa-seaplane-bases',
  'Seaplane Bases',
  'aviation',
  'OurAirports',
  'Water aerodromes for floatplanes.',
  {
    style: { color: '#26c6da', size: 5 },
    info: airportInfo,
    statsBy: 'country',
  },
);
feed(
  'oa-airports-closed',
  'Closed & Abandoned Airfields',
  'aviation',
  'OurAirports',
  'Airfields that are closed or abandoned — useful for history and OSINT.',
  {
    style: { color: '#757575', size: 4 },
    info: airportInfo,
    statsBy: 'country',
  },
);
feed(
  'oa-balloonports',
  'Balloon Ports',
  'aviation',
  'OurAirports',
  'Registered hot-air balloon launch sites.',
  { style: { color: '#ff8a80', size: 6, label: 'name' }, info: airportInfo },
);
const navInfo = {
  title: 'name',
  fields: [
    ['Ident', 'ident', 'text'],
    ['Type', 'type', 'text'],
    ['Frequency', 'frequency', 'text'],
    ['Power', 'power', 'text'],
    ['Airport', 'airport', 'text'],
    ['Country', 'country', 'text'],
  ],
};
feed(
  'oa-navaids-vor',
  'VOR / VORTAC Beacons',
  'aviation',
  'OurAirports',
  'VHF omnidirectional range navigation beacons.',
  {
    style: { color: '#64ffda', size: 6, label: 'ident', labelMax: 60 },
    info: navInfo,
    statsBy: 'type',
  },
);
feed(
  'oa-navaids-ndb',
  'NDB Beacons',
  'aviation',
  'OurAirports',
  'Non-directional radio beacons.',
  {
    style: { color: '#ffd740', size: 5, label: 'ident', labelMax: 40 },
    info: navInfo,
    statsBy: 'type',
  },
);
feed(
  'oa-navaids-tacan',
  'TACAN & DME',
  'aviation',
  'OurAirports',
  'Military TACAN and distance-measuring equipment stations.',
  {
    style: { color: '#ff6e40', size: 6, label: 'ident', labelMax: 40 },
    info: navInfo,
    statsBy: 'type',
  },
);
feed(
  'ne-airports',
  'Airports (Natural Earth)',
  'aviation',
  'Natural Earth',
  'About 900 notable airports with Wikipedia links (small, global set that is light to draw).',
  {
    style: { color: '#82b1ff', size: 7, label: 'iata', labelMax: 120 },
    info: {
      title: 'name',
      fields: [
        ['IATA', 'iata', 'text'],
        ['ICAO', 'ident', 'text'],
        ['Type', 'type', 'text'],
        ['Wikipedia', 'link', 'link'],
      ],
    },
    statsBy: 'type',
  },
);
osm(
  'aerodromes',
  'Airfields (OSM, all classes)',
  'aviation',
  { layer: 'aerodrome_label', minZoom: 8 },
  'Every mapped aerodrome label: international, regional, military and private.',
  {
    maxAltitudeM: 600_000,
    style: {
      color: '#7ad7ff',
      size: 7,
      label: 'name',
      colorBy: {
        prop: 'class',
        map: {
          international: '#7ad7ff',
          public: '#4fc3f7',
          regional: '#4fc3f7',
          military: '#ff5252',
          private: '#90a4ae',
          other: '#90a4ae',
        },
      },
    },
    info: {
      title: 'name',
      fields: [
        ['Class', 'class', 'text'],
        ['IATA', 'iata', 'text'],
        ['ICAO', 'icao', 'text'],
        ['Elevation', 'ele', 'm'],
      ],
    },
    statsBy: 'class',
  },
);
osm(
  'military-airfields',
  'Military Airfields (OSM)',
  'aviation',
  { layer: 'aerodrome_label', class: ['military'], minZoom: 8 },
  'Aerodromes tagged as military in OpenStreetMap.',
  {
    maxAltitudeM: 1_200_000,
    style: { color: '#ff5252', size: 8, label: 'name' },
    info: {
      title: 'name',
      fields: [
        ['IATA', 'iata', 'text'],
        ['ICAO', 'icao', 'text'],
        ['Elevation', 'ele', 'm'],
      ],
    },
  },
);
osm(
  'runways',
  'Runways & Taxiways',
  'aviation',
  { layer: 'aeroway', class: ['runway', 'taxiway'], minZoom: 10 },
  'Runway and taxiway centerlines and areas from OpenStreetMap.',
  {
    geometry: 'auto',
    maxAltitudeM: 150_000,
    style: {
      color: '#e0e0e0',
      width: 2,
      fill: 0.25,
      label: 'ref',
      colorBy: {
        prop: 'class',
        map: { runway: '#e0e0e0', taxiway: '#ffd54f' },
      },
    },
    info: { title: 'ref', fields: [['Class', 'class', 'text']] },
    statsBy: 'class',
  },
);
osm(
  'helipads',
  'Helipads (OSM)',
  'aviation',
  { layer: 'aeroway', class: ['helipad', 'heliport'], minZoom: 12 },
  'Helipads and heliports mapped in OpenStreetMap.',
  {
    geometry: 'auto',
    maxAltitudeM: 60_000,
    style: { color: '#ba68c8', size: 7, width: 1.5, fill: 0.3 },
  },
);

// ═══ RAIL, ROAD & SEA ════════════════════════════════════════════════════

tiles(
  'orm-railways',
  'Railway Network (OpenRailwayMap)',
  'transport',
  'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
  'OpenRailwayMap',
  'Worldwide railway infrastructure: main lines, branch lines, tram and metro (OpenRailwayMap, non-commercial use).',
  { maxLevel: 19 },
);
tiles(
  'orm-maxspeed',
  'Railway Speed Limits',
  'transport',
  'https://tiles.openrailwaymap.org/maxspeed/{z}/{x}/{y}.png',
  'OpenRailwayMap',
  'Line speed limits on the rail network (OpenRailwayMap).',
  { maxLevel: 19 },
);
tiles(
  'orm-electrification',
  'Railway Electrification',
  'transport',
  'https://tiles.openrailwaymap.org/electrification/{z}/{x}/{y}.png',
  'OpenRailwayMap',
  'Electrified lines by voltage and current type (OpenRailwayMap).',
  { maxLevel: 19 },
);
tiles(
  'orm-signals',
  'Railway Signalling',
  'transport',
  'https://tiles.openrailwaymap.org/signals/{z}/{x}/{y}.png',
  'OpenRailwayMap',
  'Train protection and signalling systems (OpenRailwayMap).',
  { maxLevel: 19 },
);
tiles(
  'esri-transportation',
  'Roads & Highways Reference',
  'transport',
  `${ESRI}Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
  'Esri',
  'Road network and route shields drawn over imagery (Esri World Transportation).',
  { maxLevel: 18 },
);
for (const [trail, name] of [
  ['hiking', 'Hiking Routes'],
  ['cycling', 'Cycling Routes'],
  ['mtb', 'Mountain Bike Routes'],
  ['slopes', 'Ski Slopes & Pistes'],
  ['riding', 'Horse Riding Routes'],
  ['skating', 'Inline Skating Routes'],
]) {
  tiles(
    `trails-${trail}`,
    name,
    'transport',
    `https://tile.waymarkedtrails.org/${trail}/{z}/{x}/{y}.png`,
    'Waymarked Trails',
    `Signed ${name.toLowerCase()} from OpenStreetMap route relations (Waymarked Trails, CC BY-SA).`,
    { maxLevel: 18 },
  );
}
osm(
  'railways',
  'Rail Lines (OSM)',
  'transport',
  { layer: 'transportation', class: ['rail'], minZoom: 9 },
  'Railway lines from OpenStreetMap for the area in view.',
  {
    geometry: 'line',
    maxAltitudeM: 250_000,
    style: { color: '#c0a6ff', width: 2 },
    info: {
      title: 'subclass',
      fields: [
        ['Class', 'class', 'text'],
        ['Bridge / tunnel', 'brunnel', 'text'],
      ],
    },
  },
);
osm(
  'transit-lines',
  'Metro, Tram & Light Rail',
  'transport',
  { layer: 'transportation', class: ['transit'], minZoom: 11 },
  'Subway, tram, light rail and monorail lines from OpenStreetMap.',
  {
    geometry: 'line',
    maxAltitudeM: 80_000,
    style: { color: '#ff80ab', width: 2 },
    info: { title: 'subclass', fields: [['Class', 'class', 'text']] },
  },
);
osm(
  'aerialways',
  'Cable Cars & Ski Lifts',
  'transport',
  { layer: 'transportation', class: ['aerialway'], minZoom: 12 },
  'Aerial tramways, gondolas and ski lifts.',
  {
    geometry: 'line',
    maxAltitudeM: 60_000,
    style: { color: '#ffe082', width: 2 },
  },
);
osm(
  'ferry-routes',
  'Ferry Routes',
  'transport',
  { layer: 'transportation', class: ['ferry'], minZoom: 7 },
  'Ferry routes from OpenStreetMap.',
  {
    geometry: 'line',
    maxAltitudeM: 800_000,
    style: { color: '#4dd0e1', width: 2 },
  },
);
osm(
  'motorways',
  'Motorways & Trunk Roads',
  'transport',
  { layer: 'transportation', class: ['motorway', 'trunk'], minZoom: 7 },
  'Motorways and trunk roads from OpenStreetMap.',
  {
    geometry: 'line',
    maxAltitudeM: 400_000,
    style: { color: '#ffb74d', width: 2 },
    statsBy: 'class',
  },
);
osm(
  'bridges',
  'Bridges',
  'transport',
  { layer: 'transportation', where: { brunnel: ['bridge'] }, minZoom: 12 },
  'Road and rail bridges from OpenStreetMap.',
  {
    geometry: 'line',
    maxAltitudeM: 40_000,
    style: { color: '#fff59d', width: 3 },
    statsBy: 'class',
  },
);
osm(
  'tunnels',
  'Tunnels',
  'transport',
  { layer: 'transportation', where: { brunnel: ['tunnel'] }, minZoom: 12 },
  'Road and rail tunnels from OpenStreetMap.',
  {
    geometry: 'line',
    maxAltitudeM: 40_000,
    style: { color: '#9e9e9e', width: 3 },
    statsBy: 'class',
  },
);
osm(
  'rail-stations',
  'Train & Metro Stations',
  'transport',
  { class: ['railway'], minZoom: 12 },
  'Railway stations, halts, metro and tram stops.',
  { maxAltitudeM: 60_000, style: { color: '#c0a6ff', size: 7 } },
);
osm(
  'bus-stations',
  'Bus Stations',
  'transport',
  { subclass: ['bus_station'] },
  'Bus stations and terminals.',
  { style: { color: '#ffd54f' } },
);
osm(
  'bus-stops',
  'Bus Stops',
  'transport',
  { subclass: ['bus_stop'] },
  'Individual bus stops.',
  { style: { color: '#ffe082', size: 4, label: null } },
);
osm(
  'ferry-terminals',
  'Ferry Terminals',
  'transport',
  { subclass: ['ferry_terminal'], minZoom: 12 },
  'Ferry terminals from OpenStreetMap.',
  { maxAltitudeM: 60_000, style: { color: '#4dd0e1', size: 7 } },
);
osm(
  'parking',
  'Parking',
  'transport',
  { subclass: ['parking'] },
  'Car parks and parking garages.',
  { style: { color: '#64b5f6', size: 4, label: null } },
);
osm(
  'bicycle-rental',
  'Bike Rental & Parking',
  'transport',
  { subclass: ['bicycle_rental', 'bicycle_parking'] },
  'Bike-share docks, bicycle rental and bicycle parking.',
  { style: { color: '#69f0ae', size: 4 } },
);
osm(
  'car-services',
  'Car Dealers, Repair & Taxis',
  'transport',
  { class: ['car'] },
  'Car dealers, repair shops, parts stores and taxi ranks.',
  { style: { color: '#90caf9', size: 5 } },
);
feed(
  'ne-ports',
  'Seaports',
  'transport',
  'Natural Earth',
  'About 1,000 notable seaports worldwide.',
  {
    style: { color: '#4dd0e1', size: 6, label: 'name', labelMax: 60 },
    info: { title: 'name', fields: [['Website', 'link', 'link']] },
  },
);

// ═══ EMERGENCY & PUBLIC SAFETY ═══════════════════════════════════════════

osm(
  'hospitals',
  'Hospitals',
  'safety',
  { subclass: ['hospital'] },
  'Hospitals from OpenStreetMap.',
  { style: { color: '#ff4d6d', size: 8 } },
);
osm(
  'clinics',
  'Clinics & Doctors',
  'safety',
  { subclass: ['clinic', 'doctors'] },
  'Clinics and doctors’ practices.',
  { style: { color: '#ff8fa3', size: 5 } },
);
osm(
  'pharmacies',
  'Pharmacies',
  'safety',
  { subclass: ['pharmacy', 'chemist'] },
  'Pharmacies and chemists.',
  { style: { color: '#69f0ae', size: 5 } },
);
osm(
  'dentists',
  'Dentists',
  'safety',
  { subclass: ['dentist'] },
  'Dentists and dental practices from OpenStreetMap.',
  { style: { color: '#e1bee7', size: 4 } },
);
osm(
  'veterinary',
  'Veterinary Clinics',
  'safety',
  { subclass: ['veterinary'] },
  'Veterinary clinics and animal hospitals from OpenStreetMap.',
  { style: { color: '#bcaaa4', size: 4 } },
);
osm(
  'fire-stations',
  'Fire Stations',
  'safety',
  { subclass: ['fire_station'] },
  'Fire stations from OpenStreetMap.',
  { style: { color: '#ff3d00', size: 7 } },
);
osm(
  'police',
  'Police Stations',
  'safety',
  { subclass: ['police'] },
  'Police stations from OpenStreetMap.',
  { style: { color: '#448aff', size: 7 } },
);
osm(
  'shelters',
  'Shelters',
  'safety',
  { subclass: ['shelter'] },
  'Emergency, weather and hiking shelters.',
  { style: { color: '#ffab40', size: 5 } },
);
osm(
  'drinking-water',
  'Drinking Water',
  'safety',
  { subclass: ['drinking_water'] },
  'Public drinking-water taps and fountains.',
  { style: { color: '#40c4ff', size: 4, label: null } },
);
osm(
  'toilets',
  'Public Toilets',
  'safety',
  { subclass: ['toilets'] },
  'Public toilets from OpenStreetMap.',
  { style: { color: '#b0bec5', size: 4, label: null } },
);
osm(
  'nursing-homes',
  'Nursing Homes',
  'safety',
  { subclass: ['nursing_home'] },
  'Nursing and care homes.',
  { style: { color: '#f48fb1', size: 5 } },
);

// ═══ GOVERNMENT & SECURITY ═══════════════════════════════════════════════

osm(
  'embassies',
  'Embassies & Consulates',
  'government',
  { class: ['office'], subclass: ['diplomatic'] },
  'Diplomatic missions mapped in OpenStreetMap.',
  { style: { color: '#ffd740', size: 7 } },
);
osm(
  'government-offices',
  'Government Offices',
  'government',
  { class: ['office'], subclass: ['government', 'quango'] },
  'Government agencies and offices.',
  { style: { color: '#b0bec5', size: 6 } },
);
osm(
  'town-halls',
  'Town Halls & Civic Buildings',
  'government',
  { subclass: ['townhall', 'public_building', 'community_centre'] },
  'Town halls, public buildings and community centres.',
  { style: { color: '#e0e0e0', size: 6 } },
);
osm(
  'courthouses',
  'Courthouses',
  'government',
  { subclass: ['courthouse'] },
  'Courthouses and court buildings from OpenStreetMap.',
  { style: { color: '#bcaaa4', size: 6 } },
);
osm(
  'prisons',
  'Prisons',
  'government',
  { subclass: ['prison'] },
  'Prisons and detention facilities.',
  { style: { color: '#ff7043', size: 7 } },
);
osm(
  'border-control',
  'Border Crossings',
  'government',
  { subclass: ['border_control'] },
  'Border control posts.',
  { style: { color: '#ff5252', size: 7 } },
);
osm(
  'toll-booths',
  'Toll Booths',
  'government',
  { subclass: ['toll_booth'] },
  'Road toll booths and toll plazas from OpenStreetMap.',
  { style: { color: '#ffd54f', size: 5 } },
);
osm(
  'post-offices',
  'Post Offices',
  'government',
  { subclass: ['post_office', 'parcel_locker'] },
  'Post offices, parcel lockers and postal counters from OpenStreetMap.',
  { style: { color: '#ffca28', size: 5 } },
);
osm(
  'political-ngo',
  'NGOs, Unions & Political Parties',
  'government',
  {
    class: ['office'],
    subclass: ['ngo', 'political_party', 'union', 'association', 'foundation'],
  },
  'Non-governmental organisations, unions, associations and party offices.',
  { style: { color: '#ce93d8', size: 5 } },
);
osm(
  'military-landuse',
  'Military Land (OSM)',
  'government',
  { layer: 'landuse', class: ['military'], minZoom: 8 },
  'Military land-use polygons from OpenStreetMap (outline view; see the built-in Mapped Installations layer for named sites).',
  {
    geometry: 'polygon',
    maxAltitudeM: 300_000,
    style: { color: '#ff5252', width: 1.5, fill: 0.15 },
  },
);
osm(
  'telecom-offices',
  'Telecom & Security Companies',
  'government',
  { class: ['office'], subclass: ['telecommunication', 'security'] },
  'Telecommunication and security company offices.',
  { style: { color: '#80cbc4', size: 5 } },
);

// ═══ HEALTH, EDUCATION & CIVIC ═══════════════════════════════════════════

osm(
  'schools',
  'Schools & Kindergartens',
  'civic',
  { class: ['school'] },
  'Schools and kindergartens.',
  { style: { color: '#5ee6a8', size: 6 } },
);
osm(
  'universities',
  'Universities & Colleges',
  'civic',
  { class: ['college'], minZoom: 10 },
  'Universities and colleges (large campuses show from further out).',
  { maxAltitudeM: 120_000, style: { color: '#00e5ff', size: 8 } },
);
osm(
  'libraries',
  'Libraries & Bookshops',
  'civic',
  { class: ['library'] },
  'Libraries and bookshops.',
  { style: { color: '#a5d6a7', size: 5 } },
);
osm(
  'places-of-worship',
  'Places of Worship',
  'civic',
  { subclass: ['place_of_worship'] },
  'Churches, mosques, temples, synagogues and shrines.',
  { style: { color: '#fff59d', size: 5 } },
);
osm(
  'cemeteries',
  'Cemeteries',
  'civic',
  { layer: 'landuse', class: ['cemetery'], minZoom: 11 },
  'Cemeteries and graveyards.',
  {
    geometry: 'polygon',
    maxAltitudeM: 60_000,
    style: { color: '#a1887f', width: 1, fill: 0.25 },
  },
);
osm(
  'playgrounds',
  'Playgrounds',
  'civic',
  { subclass: ['playground'] },
  'Children’s playgrounds.',
  { style: { color: '#ffab91', size: 4, label: null } },
);
osm(
  'residential-zones',
  'Residential Areas',
  'civic',
  { layer: 'landuse', class: ['residential'], minZoom: 10 },
  'Residential land use from OpenStreetMap.',
  {
    geometry: 'polygon',
    maxAltitudeM: 60_000,
    style: { color: '#ffcc80', width: 0.8, fill: 0.12 },
  },
);
osm(
  'commercial-zones',
  'Commercial & Retail Areas',
  'civic',
  { layer: 'landuse', class: ['commercial', 'retail'], minZoom: 10 },
  'Commercial and retail land use.',
  {
    geometry: 'polygon',
    maxAltitudeM: 60_000,
    style: { color: '#f48fb1', width: 0.8, fill: 0.15 },
  },
);
osm(
  'coworking',
  'Offices & Coworking',
  'civic',
  {
    class: ['office'],
    subclass: [
      'coworking',
      'company',
      'it',
      'research',
      'educational_institution',
    ],
  },
  'Company offices, coworking spaces and research institutes.',
  { style: { color: '#90caf9', size: 4 } },
);
osm(
  'tall-buildings',
  '3D Buildings (OSM heights)',
  'civic',
  { layer: 'building', minZoom: 14 },
  'OpenStreetMap building footprints extruded to their mapped heights — tallest first. Draws the area around the view center.',
  {
    geometry: 'polygon',
    maxAltitudeM: 12_000,
    style: {
      color: '#00d4ff',
      width: 0,
      fill: 0.55,
      extrude: { prop: 'render_height', min: 25 },
    },
    info: {
      title: 'Building',
      fields: [
        ['Height', 'render_height', 'm'],
        ['Base', 'render_min_height', 'm'],
      ],
    },
    statsBy: null,
  },
);

// ═══ CULTURE, TOURISM & LEISURE ══════════════════════════════════════════

osm(
  'museums',
  'Museums & Galleries',
  'culture',
  { subclass: ['museum', 'gallery', 'arts_centre'] },
  'Museums, galleries and arts centres.',
  { style: { color: '#ff8ad8', size: 6 } },
);
osm(
  'castles',
  'Castles & Ruins',
  'culture',
  { class: ['castle'] },
  'Castles, fortresses and ruins.',
  { style: { color: '#d7ccc8', size: 6 } },
);
osm(
  'monuments',
  'Monuments & Memorials',
  'culture',
  { subclass: ['monument'] },
  'Monuments and memorials.',
  { style: { color: '#ffe0b2', size: 5 } },
);
osm(
  'attractions',
  'Attractions & Viewpoints',
  'culture',
  { class: ['attraction'] },
  'Tourist attractions and scenic viewpoints.',
  { style: { color: '#ffd740', size: 6 } },
);
osm(
  'theatres',
  'Theatres & Cinemas',
  'culture',
  { subclass: ['theatre', 'cinema'] },
  'Theatres and cinemas.',
  { style: { color: '#ea80fc', size: 5 } },
);
osm(
  'stadiums',
  'Stadiums',
  'culture',
  { class: ['stadium'], subclass: ['stadium'] },
  'Stadiums from OpenStreetMap.',
  { style: { color: '#69f0ae', size: 7 } },
);
osm(
  'sports-centres',
  'Sports Centres & Pitches',
  'culture',
  { subclass: ['sports_centre', 'pitch', 'ice_rink'] },
  'Sports centres, pitches and ice rinks.',
  { style: { color: '#b2ff59', size: 4 } },
);
osm(
  'swimming',
  'Swimming Pools & Water Parks',
  'culture',
  { subclass: ['swimming_pool', 'swimming_area', 'water_park'] },
  'Swimming pools, bathing areas and water parks.',
  { style: { color: '#40c4ff', size: 5 } },
);
osm(
  'golf',
  'Golf Courses',
  'culture',
  { class: ['golf'] },
  'Golf courses and mini-golf.',
  { style: { color: '#76ff03', size: 6 } },
);
osm(
  'zoos',
  'Zoos & Aquariums',
  'culture',
  { subclass: ['zoo', 'aquarium', 'wildlife_park', 'safari_park'] },
  'Zoos, aquariums and wildlife parks.',
  { style: { color: '#ffab40', size: 7 } },
);
osm(
  'theme-parks',
  'Theme Parks',
  'culture',
  { subclass: ['theme_park'] },
  'Theme and amusement parks.',
  { style: { color: '#ff4081', size: 7 } },
);
osm(
  'hotels',
  'Hotels & Lodging',
  'culture',
  { class: ['lodging'] },
  'Hotels, motels, hostels, guest houses and alpine huts.',
  { style: { color: '#82b1ff', size: 5 } },
);
osm(
  'campsites',
  'Campsites & Caravan Parks',
  'culture',
  { class: ['campsite'] },
  'Campsites and caravan sites.',
  { style: { color: '#aed581', size: 6 } },
);
osm(
  'picnic-sites',
  'Picnic Sites & BBQ',
  'culture',
  { subclass: ['picnic_site', 'bbq'] },
  'Picnic sites and barbecue spots.',
  { style: { color: '#c5e1a5', size: 4 } },
);
osm(
  'nightlife',
  'Bars, Pubs & Nightclubs',
  'culture',
  { class: ['bar', 'beer'] },
  'Bars, pubs, beer gardens and nightclubs.',
  { style: { color: '#ff80ab', size: 5 } },
);
osm(
  'info-points',
  'Tourist Information',
  'culture',
  { subclass: ['information'] },
  'Tourist information offices and boards.',
  { style: { color: '#80d8ff', size: 4 } },
);
osm(
  'parks',
  'City Parks & Gardens',
  'culture',
  { subclass: ['park', 'garden', 'dog_park'] },
  'Urban parks, gardens and dog parks.',
  { style: { color: '#9ccc65', size: 5 } },
);

// ═══ FOOD, SHOPS & SERVICES ══════════════════════════════════════════════

osm(
  'restaurants',
  'Restaurants',
  'commerce',
  { subclass: ['restaurant'] },
  'Restaurants from OpenStreetMap.',
  { style: { color: '#ffd36e', size: 4 } },
);
osm(
  'fast-food',
  'Fast Food',
  'commerce',
  { class: ['fast_food'] },
  'Fast food outlets and food courts.',
  { style: { color: '#ffab40', size: 4 } },
);
osm(
  'cafes',
  'Cafés',
  'commerce',
  { class: ['cafe', 'ice_cream'] },
  'Cafés and ice-cream shops.',
  { style: { color: '#bcaaa4', size: 4 } },
);
osm(
  'supermarkets',
  'Supermarkets & Markets',
  'commerce',
  { class: ['grocery'] },
  'Supermarkets, greengrocers, department stores and marketplaces.',
  { style: { color: '#69f0ae', size: 5 } },
);
osm(
  'bakeries',
  'Bakeries & Butchers',
  'commerce',
  { subclass: ['bakery', 'butcher', 'deli', 'chocolate', 'confectionery'] },
  'Bakeries, butchers, delis and confectioners.',
  { style: { color: '#ffcc80', size: 4 } },
);
osm(
  'banks',
  'Banks & ATMs',
  'commerce',
  { subclass: ['bank', 'atm'] },
  'Bank branches and cash machines.',
  { style: { color: '#ffe57f', size: 5 } },
);
osm(
  'shops',
  'All Shops',
  'commerce',
  { class: ['shop', 'clothing_store', 'alcohol_shop', 'music'] },
  'Every shop OpenFreeMap carries: clothing, electronics, hardware, kiosks and more.',
  { style: { color: '#ffd36e', size: 3, label: null } },
);
osm(
  'malls',
  'Shopping Malls',
  'commerce',
  { subclass: ['mall', 'department_store'] },
  'Shopping malls and department stores.',
  { style: { color: '#ff80ab', size: 7 } },
);
osm(
  'electronics',
  'Electronics & Phone Shops',
  'commerce',
  {
    subclass: [
      'electronics',
      'mobile_phone',
      'computer',
      'hifi',
      'camera',
      'video_games',
    ],
  },
  'Electronics, computer and phone shops.',
  { style: { color: '#80d8ff', size: 4 } },
);
osm(
  'hardware',
  'Hardware & DIY',
  'commerce',
  { subclass: ['hardware', 'doityourself', 'paint', 'garden_centre'] },
  'Hardware stores, DIY and garden centres.',
  { style: { color: '#bcaaa4', size: 4 } },
);
osm(
  'laundry',
  'Laundry & Dry Cleaning',
  'commerce',
  { class: ['laundry'] },
  'Laundromats and dry cleaners.',
  { style: { color: '#b3e5fc', size: 4 } },
);
osm(
  'hairdressers',
  'Hair & Beauty',
  'commerce',
  { subclass: ['hairdresser', 'beauty', 'cosmetics', 'perfumery', 'massage'] },
  'Hairdressers, beauty salons and cosmetics.',
  { style: { color: '#f8bbd0', size: 4 } },
);

// ═══ CITIES & POPULATION ═════════════════════════════════════════════════

const placeInfo = {
  title: 'name',
  fields: [
    ['Country', 'country', 'text'],
    ['Population (metro est.)', 'population', 'int'],
    ['Class', 'class', 'text'],
  ],
};
feed(
  'ne-capitals',
  'National Capitals',
  'places',
  'Natural Earth',
  'Capital cities of every country.',
  {
    style: { color: '#ffffff', size: 9, label: 'name', labelMax: 220 },
    info: placeInfo,
    statsValue: 'population',
  },
);
feed(
  'ne-state-capitals',
  'State & Provincial Capitals',
  'places',
  'Natural Earth',
  'First-level administrative capitals (states, provinces, regions).',
  {
    style: { color: '#ffe082', size: 6, label: 'name', labelMax: 120 },
    info: placeInfo,
    statsBy: 'country',
  },
);
feed(
  'ne-megacities',
  'Megacities (10M+)',
  'places',
  'Natural Earth',
  'Urban agglomerations with more than 10 million people.',
  {
    style: {
      color: '#ff4081',
      sizeBy: { prop: 'population', domain: [1e7, 4e7], range: [10, 22] },
      label: 'name',
      labelMax: 40,
    },
    info: placeInfo,
    statsValue: 'population',
  },
);
feed(
  'ne-populated-places',
  'Cities & Towns (7,300)',
  'places',
  'Natural Earth',
  'Over 7,000 populated places sized by metro population.',
  {
    style: {
      color: '#00d4ff',
      sizeBy: {
        prop: 'population',
        domain: [0, 2e7],
        range: [3, 16],
        scale: 'sqrt',
      },
      label: 'name',
      labelMax: 80,
    },
    info: placeInfo,
    statsBy: 'country',
    statsValue: 'population',
  },
);
feed(
  'ne-urban-areas',
  'Urban Footprints',
  'places',
  'Natural Earth',
  'Built-up urban areas mapped from satellite data.',
  {
    geometry: 'polygon',
    style: { color: '#ffab40', width: 1, fill: 0.35 },
    info: { title: 'Urban area', fields: [['Area', 'area_km2', 'num:0']] },
    statsValue: 'area_km2',
  },
);
feed(
  'choropleth-population',
  'Population by Country',
  'places',
  'Natural Earth',
  'Countries shaded by estimated population.',
  {
    feed: 'ne-countries',
    geometry: 'polygon',
    style: {
      color: '#00d4ff',
      width: 0.8,
      fill: 0.5,
      colorBy: {
        prop: 'population',
        stops: [
          [0, '#0d2b45'],
          [1e6, '#16507a'],
          [1e7, '#1f7fb0'],
          [5e7, '#3ab0d8'],
          [1e8, '#7fd6f0'],
          [1e9, '#e8fbff'],
        ],
      },
      label: 'name',
      labelMax: 60,
    },
    info: {
      title: 'name',
      fields: [
        ['Population', 'population', 'int'],
        ['Continent', 'continent', 'text'],
        ['ISO', 'iso3', 'text'],
      ],
    },
    statsBy: 'continent',
    statsValue: 'population',
    legend: [
      ['<1M', '#0d2b45'],
      ['1M', '#16507a'],
      ['10M', '#1f7fb0'],
      ['50M', '#3ab0d8'],
      ['100M', '#7fd6f0'],
      ['1B', '#e8fbff'],
    ],
  },
);
feed(
  'choropleth-gdp-per-capita',
  'GDP per Capita by Country',
  'places',
  'Natural Earth',
  'Countries shaded by GDP per person (Natural Earth estimates).',
  {
    feed: 'ne-countries',
    geometry: 'polygon',
    style: {
      color: '#3ddc84',
      width: 0.8,
      fill: 0.5,
      colorBy: {
        prop: 'gdp_per_capita',
        stops: [
          [0, '#3b0f2f'],
          [1000, '#7a1f3d'],
          [4000, '#c2493d'],
          [12000, '#e8a33d'],
          [30000, '#b8e04d'],
          [60000, '#3ddc84'],
        ],
      },
      label: 'name',
      labelMax: 60,
    },
    info: {
      title: 'name',
      fields: [
        ['GDP per capita (USD)', 'gdp_per_capita', 'int'],
        ['GDP ($M)', 'gdp_musd', 'int'],
        ['Economy', 'economy', 'text'],
      ],
    },
    statsBy: 'continent',
    statsValue: 'gdp_per_capita',
    legend: [
      ['<$1k', '#3b0f2f'],
      ['$1k', '#7a1f3d'],
      ['$4k', '#c2493d'],
      ['$12k', '#e8a33d'],
      ['$30k', '#b8e04d'],
      ['$60k+', '#3ddc84'],
    ],
  },
);
feed(
  'choropleth-income',
  'Income Group by Country',
  'places',
  'Natural Earth',
  'World Bank income groups by country.',
  {
    feed: 'ne-countries',
    geometry: 'polygon',
    style: {
      color: '#b48cff',
      width: 0.8,
      fill: 0.5,
      colorBy: {
        prop: 'income',
        map: {
          '1. High income: OECD': '#3ddc84',
          '2. High income: nonOECD': '#9be15d',
          '3. Upper middle income': '#ffe14d',
          '4. Lower middle income': '#ffa726',
          '5. Low income': '#ff3b3b',
        },
      },
      label: 'name',
      labelMax: 60,
    },
    info: {
      title: 'name',
      fields: [
        ['Income group', 'income', 'text'],
        ['Economy', 'economy', 'text'],
      ],
    },
    statsBy: 'income',
  },
);
feed(
  'choropleth-economy',
  'Economy Type by Country',
  'places',
  'Natural Earth',
  'Developed, emerging and least-developed economies.',
  {
    feed: 'ne-countries',
    geometry: 'polygon',
    style: {
      color: '#5fb4ff',
      width: 0.8,
      fill: 0.5,
      colorBy: {
        prop: 'economy',
        map: {
          '1. Developed region: G7': '#00d4ff',
          '2. Developed region: nonG7': '#4da3ff',
          '3. Emerging region: BRIC': '#ffa726',
          '4. Emerging region: MIKT': '#ffd166',
          '5. Emerging region: G20': '#ffe14d',
          '6. Developing region': '#ff7043',
          '7. Least developed region': '#ff3b3b',
        },
      },
      label: 'name',
      labelMax: 60,
    },
    info: {
      title: 'name',
      fields: [
        ['Economy', 'economy', 'text'],
        ['Income group', 'income', 'text'],
      ],
    },
    statsBy: 'economy',
  },
);
osm(
  'towns',
  'Cities, Towns & Villages (OSM)',
  'places',
  { layer: 'place', class: ['city', 'town', 'village'], minZoom: 6 },
  'Settlement names from OpenStreetMap for the area in view.',
  {
    maxAltitudeM: 800_000,
    style: {
      color: '#e0f7fa',
      size: 5,
      colorBy: {
        prop: 'class',
        map: { city: '#00d4ff', town: '#80deea', village: '#b2ebf2' },
      },
    },
    info: {
      title: 'name',
      fields: [
        ['Class', 'class', 'text'],
        ['Capital level', 'capital', 'int'],
      ],
    },
    statsBy: 'class',
  },
);
osm(
  'neighbourhoods',
  'Neighbourhoods & Suburbs',
  'places',
  {
    layer: 'place',
    class: ['suburb', 'quarter', 'neighbourhood', 'borough'],
    minZoom: 11,
  },
  'Neighbourhood and suburb names from OpenStreetMap.',
  {
    maxAltitudeM: 60_000,
    style: { color: '#b2ebf2', size: 4 },
    statsBy: 'class',
  },
);
tiles(
  'carto-labels',
  'City & Street Labels (CARTO)',
  'places',
  'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
  'CARTO · OSM',
  'Place, road and water labels drawn over the imagery (CARTO basemap labels, © OpenStreetMap contributors).',
  { subdomains: ['a', 'b', 'c', 'd'], maxLevel: 18, alpha: 1 },
);

// ═══ BORDERS & REFERENCE ═════════════════════════════════════════════════

feed(
  'ne-country-borders',
  'Country Borders',
  'borders',
  'Natural Earth',
  'International land boundaries (with disputed and indefinite lines).',
  {
    geometry: 'line',
    style: {
      color: '#ffffff',
      width: 1.5,
      colorBy: {
        prop: 'class',
        map: {
          'International boundary (verify)': '#ffffff',
          'Disputed (please verify)': '#ff5252',
          'Indefinite (please verify)': '#ffd740',
          'Line of control (please verify)': '#ff9100',
          Unrecognized: '#ff5252',
        },
      },
    },
    info: { title: 'class', fields: [] },
    statsBy: 'class',
  },
);
feed(
  'ne-state-borders',
  'State & Province Borders',
  'borders',
  'Natural Earth',
  'First-level internal boundaries (states, provinces, regions).',
  {
    geometry: 'line',
    style: { color: '#b0bec5', width: 1 },
    info: { title: 'country', fields: [] },
    statsBy: 'country',
  },
);
feed(
  'ne-maritime-boundaries',
  'Maritime Boundaries',
  'borders',
  'Natural Earth',
  'Maritime boundary indicator lines between EEZs.',
  { geometry: 'line', style: { color: '#4fc3f7', width: 1.5 } },
);
feed(
  'ne-disputed-areas',
  'Disputed Territories',
  'borders',
  'Natural Earth',
  'Disputed areas and breakaway regions.',
  {
    geometry: 'polygon',
    style: {
      color: '#ff5252',
      width: 1.5,
      fill: 0.25,
      label: 'name',
      labelMax: 120,
    },
    info: {
      title: 'name',
      fields: [
        ['Administered by', 'sovereign', 'text'],
        ['Note', 'note', 'text'],
      ],
    },
  },
);
feed(
  'ne-antarctic-claims',
  'Antarctic Territorial Claims',
  'borders',
  'Natural Earth',
  'National claims in Antarctica (suspended under the Antarctic Treaty).',
  {
    geometry: 'polygon',
    style: { color: '#e1bee7', width: 1.5, fill: 0.15, label: 'name' },
    info: {
      title: 'name',
      fields: [
        ['Claimant', 'sovereign', 'text'],
        ['Type', 'type', 'text'],
      ],
    },
  },
);
feed(
  'ne-time-zones',
  'Time Zones',
  'borders',
  'Natural Earth',
  'Official time zones, shaded in bands with their UTC offset.',
  {
    geometry: 'polygon',
    style: {
      color: '#7fe0ff',
      width: 0.8,
      fill: 0.18,
      colorBy: {
        prop: 'band',
        map: {
          1: '#00d4ff',
          2: '#b48cff',
          3: '#ffd166',
          4: '#3ddc84',
          5: '#ff8ad8',
          6: '#ffa726',
          7: '#5fb4ff',
          8: '#e8eaed',
        },
      },
      label: 'name',
      labelMax: 40,
    },
    info: {
      title: 'name',
      fields: [
        ['UTC offset (h)', 'offset', 'num:2'],
        ['Places', 'places', 'text'],
      ],
    },
  },
);
osm(
  'admin-borders',
  'Borders (OSM, high detail)',
  'borders',
  { layer: 'boundary', where: { admin_level: [2, 4] }, minZoom: 4 },
  'Country and state boundaries from OpenStreetMap at the detail of the current view.',
  {
    geometry: 'line',
    maxAltitudeM: 3_000_000,
    style: {
      color: '#ffffff',
      width: 1.5,
      colorBy: { prop: 'admin_level', map: { 2: '#ffffff', 4: '#90a4ae' } },
    },
    info: {
      title: 'name',
      fields: [
        ['Admin level', 'admin_level', 'int'],
        ['Disputed', 'disputed', 'int'],
        ['Maritime', 'maritime', 'int'],
      ],
    },
    statsBy: 'admin_level',
  },
);
tiles(
  'esri-boundaries-places',
  'Boundaries & Places (Esri)',
  'borders',
  `${ESRI}Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
  'Esri',
  'Esri’s reference layer of borders and place names for imagery maps.',
  { maxLevel: 18 },
);
gibs(
  'coastlines',
  'Coastlines (GIBS)',
  'borders',
  'Coastlines_15m',
  'Crisp coastline outlines from NASA GIBS.',
  { alpha: 1, maxLevel: 9 },
);
gibs(
  'reference-labels',
  'Reference Labels (GIBS)',
  'borders',
  'Reference_Labels_15m',
  'Place and feature labels from NASA GIBS.',
  { alpha: 1, maxLevel: 9 },
);

// ═══ GRIDS & MEASUREMENT (computed) ══════════════════════════════════════

computed(
  'grid-graticule-10',
  'Lat/Lon Grid · 10°',
  'grids',
  'graticule',
  'Latitude and longitude lines every 10°.',
  { params: { step: 10 }, style: { color: '#7fe0ff', width: 1, alpha: 0.55 } },
);
computed(
  'grid-graticule-1',
  'Lat/Lon Grid · 1° (view)',
  'grids',
  'graticule-local',
  'One-degree latitude/longitude grid around the current view.',
  {
    params: { step: 1 },
    dynamic: true,
    style: { color: '#7fe0ff', width: 1, alpha: 0.45 },
  },
);
computed(
  'grid-key-parallels',
  'Equator, Tropics & Polar Circles',
  'grids',
  'parallels',
  'The equator, Tropics of Cancer and Capricorn, and the Arctic and Antarctic circles (using today’s axial tilt).',
  { style: { color: '#ffd166', width: 2 } },
);
computed(
  'grid-meridians',
  'Prime Meridian & Antimeridian',
  'grids',
  'meridians',
  'The prime meridian (0°) and the antimeridian (180°).',
  { style: { color: '#ff8ad8', width: 2 } },
);
computed(
  'grid-utm-zones',
  'UTM Zones',
  'grids',
  'utm',
  'The 60 Universal Transverse Mercator zones with latitude bands, labeled like 33T.',
  { style: { color: '#b48cff', width: 1, alpha: 0.6 } },
);
computed(
  'grid-maidenhead',
  'Maidenhead Locator Grid',
  'grids',
  'maidenhead',
  'Amateur-radio Maidenhead field grid (20° × 10°), labeled AA–RR.',
  { style: { color: '#3ddc84', width: 1, alpha: 0.6 } },
);
computed(
  'grid-time-meridians',
  'Nominal Time-Zone Meridians',
  'grids',
  'time-meridians',
  'Meridians every 15° that define nominal (nautical) time zones, labeled with UTC offset.',
  { style: { color: '#ffa726', width: 1, alpha: 0.6 } },
);
computed(
  'view-range-rings',
  'Range Rings (view center)',
  'grids',
  'range-rings',
  'Distance rings at 10, 50, 100, 250, 500 and 1,000 km from the point at the center of the screen.',
  { dynamic: true, style: { color: '#00d4ff', width: 1.5 } },
);
computed(
  'view-horizon',
  'Visible Horizon',
  'grids',
  'horizon',
  'How far the camera can see: the geometric horizon circle for the current altitude.',
  { dynamic: true, style: { color: '#ff8ad8', width: 2 } },
);
computed(
  'view-antipode',
  'Antipode of View Center',
  'grids',
  'antipode',
  'The point on the exact opposite side of the Earth from the center of the screen.',
  {
    dynamic: true,
    geometry: 'point',
    style: { color: '#ffd740', size: 12, label: 'name' },
  },
);
computed(
  'view-great-circles',
  'Compass Great Circles',
  'grids',
  'compass-lines',
  'Great-circle lines leaving the view center toward N, NE, E, SE, S, SW, W and NW.',
  { dynamic: true, style: { color: '#7fe0ff', width: 1.5, alpha: 0.7 } },
);

// ═══ SUN, MOON & SPACE ═══════════════════════════════════════════════════

computed(
  'sky-night',
  'Night Side (terminator)',
  'sky',
  'night',
  'The live day/night terminator with the night hemisphere shaded.',
  {
    refreshMs: MIN,
    geometry: 'polygon',
    style: { color: '#0b1a3a', fill: 0.4, width: 1.5, outlineColor: '#ffd166' },
  },
);
computed(
  'sky-civil-twilight',
  'Civil Twilight Line',
  'sky',
  'twilight',
  'Where the sun is 6° below the horizon right now.',
  {
    params: { depression: 6 },
    refreshMs: MIN,
    style: { color: '#ffb74d', width: 1.5 },
  },
);
computed(
  'sky-nautical-twilight',
  'Nautical Twilight Line',
  'sky',
  'twilight',
  'Where the sun is 12° below the horizon.',
  {
    params: { depression: 12 },
    refreshMs: MIN,
    style: { color: '#ba68c8', width: 1.5 },
  },
);
computed(
  'sky-astronomical-twilight',
  'Astronomical Twilight Line',
  'sky',
  'twilight',
  'Where the sun is 18° below the horizon: true night begins.',
  {
    params: { depression: 18 },
    refreshMs: MIN,
    style: { color: '#5c6bc0', width: 1.5 },
  },
);
computed(
  'sky-golden-hour',
  'Golden Hour Band',
  'sky',
  'golden-hour',
  'Where the sun is between 6° above and 4° below the horizon right now — photographers’ golden and blue hour.',
  { refreshMs: MIN, style: { color: '#ffca28', width: 1.5 } },
);
computed(
  'sky-subsolar',
  'Sun Position & 24 h Track',
  'sky',
  'subsolar',
  'Where the sun is directly overhead now, and its path over the next 24 hours.',
  {
    refreshMs: MIN,
    geometry: 'mixed',
    style: { color: '#ffd740', size: 14, width: 1.5, label: 'name' },
  },
);
computed(
  'sky-sublunar',
  'Moon Position & 24 h Track',
  'sky',
  'sublunar',
  'Where the moon is directly overhead now (with phase), and its path over the next 24 hours.',
  {
    refreshMs: MIN,
    geometry: 'mixed',
    style: { color: '#e0e0e0', size: 12, width: 1.5, label: 'name' },
  },
);
feed(
  'swpc-aurora',
  'Aurora Forecast (OVATION)',
  'sky',
  'NOAA SWPC',
  'Short-term probability of visible aurora from the NOAA OVATION model.',
  {
    refreshMs: 10 * MIN,
    style: {
      color: '#69f0ae',
      size: 4,
      colorBy: {
        prop: 'probability',
        stops: [
          [8, '#1b5e20'],
          [20, '#2e7d32'],
          [40, '#69f0ae'],
          [60, '#ffeb3b'],
          [80, '#ff5252'],
        ],
      },
    },
    info: {
      title: 'Aurora',
      fields: [['Probability (%)', 'probability', 'int']],
    },
    statsValue: 'probability',
    legend: [
      ['10%', '#1b5e20'],
      ['20%', '#2e7d32'],
      ['40%', '#69f0ae'],
      ['60%', '#ffeb3b'],
      ['80%', '#ff5252'],
    ],
  },
);
feed(
  'wikipedia-nearby',
  'Wikipedia Articles Nearby',
  'culture',
  'Wikipedia',
  'Geotagged Wikipedia articles within 10 km of the view center.',
  {
    query: 'point',
    maxAltitudeM: 150_000,
    refreshMs: 30 * MIN,
    style: { color: '#ffffff', size: 6, label: 'name', labelMax: 60 },
    info: {
      title: 'name',
      fields: [
        ['Distance from center', 'distance_m', 'm'],
        ['Article', 'link', 'link'],
      ],
    },
  },
);

// Second wave: more NASA layers, radar, biodiversity, keyed tiles, live
// feeds and World Bank statistics (./definitionsPlus.js).
addPlusDefinitions({ add, gibs, tiles, feed, quakeStyle, quakeInfo });

/** The frozen overlay catalog. */
export const OVERLAY_DEFINITIONS = Object.freeze(
  defs.map((d) => Object.freeze(d)),
);
export const OVERLAY_BY_ID = new Map(OVERLAY_DEFINITIONS.map((d) => [d.id, d]));
