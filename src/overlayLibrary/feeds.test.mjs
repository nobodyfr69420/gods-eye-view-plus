import test from 'node:test';
import assert from 'node:assert/strict';
import {
  airportFeatures,
  auroraFeatures,
  cleanGeometry,
  cleanText,
  cleanUrl,
  countryIndicatorFeatures,
  gdacsFeatures,
  ndbcFeatures,
  NWS_GROUPS,
  nwpsFloodFeatures,
  nwsAlertFeatures,
  parseCsv,
  powerPlantFeatures,
  sensorCommunityFeatures,
  spcFeatures,
  usgsVolcanoFeatures,
} from '../../server/providers/overlayFeeds/parsers.js';
import {
  createOverlayFeedService,
  overlayFeedsProxy,
  parseOverlayBbox,
  parseOverlayPoint,
} from '../../server/providers/overlayFeeds.js';
import { getOverlayFeed } from '../../server/providers/overlayFeeds/feeds.js';

test('text, number and url cleaning bounds untrusted values', () => {
  assert.equal(cleanText('  a\u0000b\n c  '), 'a b c');
  assert.equal(cleanText('null'), null);
  assert.equal(cleanText('x'.repeat(300)).length, 160);
  assert.equal(cleanUrl('javascript:alert(1)'), null);
  assert.equal(cleanUrl('https://example.org/a'), 'https://example.org/a');
});

test('geometry cleaning rounds, validates and drops broken shapes', () => {
  assert.deepEqual(
    cleanGeometry({ type: 'Point', coordinates: [12.3456789, 45.6789012, 10] }),
    {
      type: 'Point',
      coordinates: [12.34568, 45.6789],
    },
  );
  assert.equal(cleanGeometry({ type: 'Point', coordinates: [200, 10] }), null);
  assert.equal(
    cleanGeometry({ type: 'LineString', coordinates: [[0, 0]] }),
    null,
  );
  assert.equal(
    cleanGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    }),
    null,
  );
  assert.equal(cleanGeometry(null), null);
});

test('CSV parser handles quotes, commas, escaped quotes and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,\n');
  assert.deepEqual(rows, [
    { a: '1', b: 'x, y', c: 'say "hi"' },
    { a: '2', b: '', c: '' },
  ]);
});

test('power plants and airports are split by type with slim properties', () => {
  const plants = powerPlantFeatures(
    [
      {
        name: 'A',
        primary_fuel: 'Nuclear',
        latitude: '10',
        longitude: '20',
        capacity_mw: '1000',
        country_long: 'X',
      },
      { name: 'B', primary_fuel: 'Coal', latitude: '10', longitude: '20' },
      { name: 'C', primary_fuel: 'Nuclear', latitude: 'bad', longitude: '20' },
    ],
    ['Nuclear'],
  );
  assert.equal(plants.length, 1);
  assert.equal(plants[0].properties.capacity_mw, 1000);
  const airports = airportFeatures(
    [
      {
        type: 'large_airport',
        name: 'Big',
        latitude_deg: '1',
        longitude_deg: '2',
        iata_code: 'BIG',
        wikipedia_link: 'https://en.wikipedia.org/wiki/Big',
      },
      { type: 'heliport', name: 'Pad', latitude_deg: '1', longitude_deg: '2' },
    ],
    ['large_airport'],
  );
  assert.equal(airports.length, 1);
  assert.equal(airports[0].properties.iata, 'BIG');
});

test('GDACS events are filtered by type and deduplicated across lists', () => {
  const event = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10, 10] },
    properties: {
      eventtype: 'FL',
      eventid: 7,
      name: 'Flood',
      alertlevel: 'Orange',
      url: { report: 'https://www.gdacs.org/r' },
    },
  };
  const quake = {
    ...event,
    properties: { ...event.properties, eventtype: 'EQ', eventid: 8 },
  };
  const out = gdacsFeatures(
    [{ features: [event, quake] }, { features: [event] }],
    'FL',
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].properties.alert, 'Orange');
  assert.equal(out[0].properties.link, 'https://www.gdacs.org/r');
});

test('NWS alerts keep only storm-based polygons for the requested group', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ];
  const body = {
    features: [
      {
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { event: 'Tornado Warning' },
      },
      {
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { event: 'Heat Advisory' },
      },
      { geometry: null, properties: { event: 'Tornado Watch' } },
    ],
  };
  assert.equal(nwsAlertFeatures(body, NWS_GROUPS.tornado).length, 1);
  assert.equal(nwsAlertFeatures(body, NWS_GROUPS.heat).length, 1);
  assert.equal(nwsAlertFeatures(body, NWS_GROUPS.all).length, 2);
});

test('SPC outlook colors survive only as hex, regardless of key case', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ];
  const out = spcFeatures({
    features: [
      {
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          label: 'SLGT',
          label2: 'Slight Risk',
          fill: '#FFE066',
          stroke: 'url(x)',
        },
      },
    ],
  });
  assert.equal(out[0].properties.label, 'SLGT');
  assert.equal(out[0].properties.name, 'Slight Risk');
  assert.equal(out[0].properties.fill, '#FFE066');
  assert.equal(out[0].properties.stroke, null);
});

test('sensor, buoy, aurora, volcano and gauge parsers produce points', () => {
  const dust = sensorCommunityFeatures([
    {
      location: {
        id: 1,
        latitude: '48.5',
        longitude: '9.2',
        indoor: 0,
        country: 'DE',
      },
      sensor: { id: 9 },
      sensordatavalues: [
        { value_type: 'P2', value: '12.5' },
        { value_type: 'P1', value: '20' },
      ],
    },
    {
      location: { id: 2, latitude: '48.5', longitude: '9.2', indoor: 1 },
      sensordatavalues: [{ value_type: 'P2', value: '3' }],
    },
  ]);
  assert.equal(dust.length, 1);
  assert.equal(dust[0].properties.pm25, 12.5);

  const ndbc = ndbcFeatures(
    '#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE\n#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft\n22101    37.24   126.02  2026 10 05 03 00 320   9.0    MM  1.0   0   MM  MM     MM    MM  18.2  23.2    MM   MM     MM\n',
  );
  assert.equal(ndbc.length, 1);
  assert.equal(ndbc[0].properties.wave_m, 1);
  assert.equal(ndbc[0].properties.gust_ms, null);
  assert.equal(ndbc[0].properties.time, '2026-10-05T03:00Z');

  const aurora = auroraFeatures({
    coordinates: [
      [0, -90, 1],
      [270, 65, 40],
      [10, 60, 7],
    ],
  });
  assert.equal(aurora.length, 1);
  assert.deepEqual(aurora[0].geometry.coordinates, [-90, 65]);

  assert.equal(
    usgsVolcanoFeatures([
      { vName: 'Test', lat: 60, long: -152, colorCode: 'YELLOW' },
    ])[0].properties.color,
    'YELLOW',
  );

  const gauges = nwpsFloodFeatures({
    gauges: [
      {
        lid: 'ABC1',
        name: 'River',
        latitude: 30,
        longitude: -97,
        status: {
          observed: { floodCategory: 'minor' },
          forecast: { floodCategory: 'moderate' },
        },
      },
      {
        lid: 'ABC2',
        name: 'Calm',
        latitude: 30,
        longitude: -97,
        status: { observed: { floodCategory: 'no_flooding' } },
      },
    ],
  });
  assert.equal(gauges.length, 1);
  assert.equal(gauges[0].properties.category, 'moderate');
});

test('country indicators derive GDP per capita', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ];
  const [country] = countryIndicatorFeatures({
    features: [
      {
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { NAME: 'X', POP_EST: 1_000_000, GDP_MD: 10_000 },
      },
    ],
  });
  assert.equal(country.properties.gdp_per_capita, 10_000);
});

test('bbox and point queries are validated and quantized', () => {
  assert.deepEqual(parseOverlayBbox('-97.3,30.1,-95.2,31.9', 8), {
    west: -97.5,
    south: 30,
    east: -95,
    north: 32,
  });
  assert.equal(parseOverlayBbox('-120,30,-90,40', 8), null);
  assert.equal(parseOverlayBbox('a,b,c,d'), null);
  assert.equal(parseOverlayBbox('10,10,5,20'), null);
  assert.deepEqual(parseOverlayPoint('30.267', '-97.743'), {
    lat: 30.25,
    lon: -97.75,
  });
  assert.equal(parseOverlayPoint('95', '0'), null);
});

test('feed service caches, coalesces and serves stale copies on failure', async () => {
  let calls = 0;
  let fail = false;
  let clock = 1_000_000;
  const fetchImpl = async () => {
    calls++;
    if (fail) return new Response('nope', { status: 503 });
    return new Response(
      JSON.stringify({
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [1, 2] },
            properties: { mag: 5, place: 'Here' },
          },
        ],
      }),
    );
  };
  const service = createOverlayFeedService({
    fetchImpl,
    now: () => clock,
    disk: false,
  });
  const feed = getOverlayFeed('usgs-significant-month');
  const [a, b] = await Promise.all([
    service.resolve(feed),
    service.resolve(feed),
  ]);
  assert.equal(calls, 1, 'concurrent requests share one upstream fetch');
  assert.equal(a.features[0].properties.name, 'Here');
  assert.equal(b.features.length, 1);
  await service.resolve(feed);
  assert.equal(calls, 1, 'fresh result served from cache');
  clock += 60 * 60_000;
  fail = true;
  const stale = await service.resolve(feed);
  assert.equal(stale.stale, true);
  assert.equal(stale.features.length, 1);
});

test('proxy rejects unknown feeds, bad bboxes and non-GET methods', async () => {
  let handler;
  overlayFeedsProxy({
    fetchImpl: async () => new Response('{}'),
    disk: false,
  }).configureServer({
    middlewares: { use: (_route, fn) => (handler = fn) },
  });
  const call = (url, method = 'GET') =>
    new Promise((resolve) => {
      const res = {
        writableEnded: false,
        writeHead(status) {
          this.status = status;
        },
        setHeader() {},
        end(body) {
          this.writableEnded = true;
          resolve({ status: this.status, body: JSON.parse(body) });
        },
      };
      handler(
        {
          url,
          method,
          headers: { host: 'localhost:4173' },
          socket: { remoteAddress: '127.0.0.1' },
        },
        res,
      );
    });
  assert.equal((await call('/does-not-exist')).status, 404);
  assert.equal((await call('/awc-metars?bbox=-140,10,-60,60')).status, 400);
  assert.equal((await call('/usgs-m45-week', 'POST')).status, 405);
  const status = await call('/status');
  assert.equal(status.status, 200);
});
