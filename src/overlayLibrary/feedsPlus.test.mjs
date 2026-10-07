import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amtrakFeatures,
  citybikesFeatures,
  digitrafficAisFeatures,
  emscFeatures,
  fireballFeatures,
  geonetFeatures,
  inatFeatures,
  iodaOutageFeatures,
  neCountryShapes,
  peeringdbFeatures,
  spcReportFeatures,
  windyWebcamFeatures,
} from '../../server/providers/overlayFeeds/feedsPlus.js';
import {
  worldBankFeatures,
  worldBankValues,
} from '../../server/providers/overlayFeeds/worldBank.js';
import {
  createOverlayTileService,
  latestRainViewerFrame,
  parseTilePath,
} from '../../server/providers/overlayTiles.js';
import { createWorldStatsService } from '../../server/providers/worldStats.js';
import {
  WORLD_INDICATOR_BY_SLUG,
  classOf,
  formatIndicator,
  indicatorText,
  quantileBreaks,
} from './worldIndicators.js';
import { worldClock } from './worldView.js';

const square = (x, y) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ],
  ],
});
const countries = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: square(0, 0),
      properties: {
        NAME: 'Alpha',
        ISO_A2_EH: 'AA',
        ISO_A3_EH: 'AAA',
        CONTINENT: 'X',
        REGION_WB: 'R1',
      },
    },
    {
      type: 'Feature',
      geometry: square(2, 0),
      properties: {
        NAME: 'France',
        ISO_A2_EH: 'FR',
        ISO_A3_EH: '-99',
        ADM0_A3: 'FRA',
        CONTINENT: 'Europe',
      },
    },
    {
      type: 'Feature',
      geometry: square(4, 0),
      properties: { NAME: 'Gamma', ISO_A2_EH: 'GG', ISO_A3_EH: 'GGG' },
    },
  ],
};

test('Natural Earth codes fall back to ADM0_A3 when ISO is -99', () => {
  assert.deepEqual(
    neCountryShapes(countries).map((f) => f.properties.iso3),
    ['AAA', 'FRA', 'GGG'],
  );
});

test('World Bank values join onto countries with rank, class and world value', () => {
  const body = [
    {},
    [
      { countryiso3code: 'AAA', value: 10, date: '2024' },
      { countryiso3code: 'FRA', value: 30, date: '2025' },
      { countryiso3code: 'GGG', value: null, date: '2025' },
      { countryiso3code: 'WLD', value: 20, date: '2025' },
      { countryiso3code: 'EUU', value: 25, date: '2025' },
      { countryiso3code: '', value: 99, date: '2025' },
    ],
  ];
  assert.equal(worldBankValues(body).size, 4);
  const indicator = WORLD_INDICATOR_BY_SLUG.get('internet');
  const features = worldBankFeatures(countries, body, indicator);
  assert.deepEqual(
    features.map((f) => f.properties.iso3),
    ['AAA', 'FRA'],
  );
  const france = features[1].properties;
  assert.equal(france.rank_text, '#1 of 2');
  assert.equal(france.display, '30% of people');
  assert.match(france.world, /^20% of people \(2025\)$/);
  assert.equal(france.q, 5);
  assert.equal(
    indicatorText(5, WORLD_INDICATOR_BY_SLUG.get('co2')),
    '5.0 t CO₂e',
  );
  assert.equal(
    indicatorText(14406, WORLD_INDICATOR_BY_SLUG.get('gdp-per-capita')),
    '$14,406',
  );
  assert.equal(
    indicatorText(31.1, WORLD_INDICATOR_BY_SLUG.get('forest')),
    '31.1% of land',
  );
});

test('quantile classes split evenly and format helpers stay readable', () => {
  const cuts = quantileBreaks([1, 2, 3, 4, 5, 6], 6);
  assert.equal(cuts.length, 5);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((v) => classOf(v, cuts)),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(formatIndicator(1.23e12, 'usdc'), '$1.23T');
  assert.equal(formatIndicator(-4.2e9, 'usdc'), '−$4.2B');
  assert.equal(formatIndicator(null, 'int'), '—');
});

test('the world clock grows population from the anchor year', () => {
  const clock = worldClock(
    {
      population: 8e9,
      year: 2025,
      growthPct: 1,
      birthRate: 16,
      deathRate: 7.5,
    },
    Date.UTC(2026, 6, 1, 12),
  );
  assert.ok(clock.population > 8.07e9 && clock.population < 8.09e9);
  assert.ok(clock.birthsPerSec > 4 && clock.birthsPerSec < 4.2);
  assert.ok(Math.abs(clock.birthsToday - clock.birthsPerSec * 43_200) < 1);
  assert.equal(worldClock({ population: NaN, year: 2025 }), null);
});

test('live feed parsers produce clean points', () => {
  const trains = amtrakFeatures({
    5: [
      {
        routeName: 'Zephyr',
        trainNum: '5',
        lat: 39.7,
        lon: -105,
        heading: 'W',
        velocity: 55,
        iconColor: '#123abc',
      },
    ],
    x: [{ lat: 'bad' }],
  });
  assert.equal(trains.length, 1);
  assert.equal(trains[0].properties.heading, 270);
  assert.equal(trains[0].properties.color, '#123abc');

  const ships = digitrafficAisFeatures(
    {
      features: [
        {
          mmsi: 1,
          geometry: { type: 'Point', coordinates: [24, 60] },
          properties: {
            mmsi: 1,
            sog: 10,
            cog: 90,
            heading: 511,
            navStat: 5,
            timestampExternal: 1,
          },
        },
      ],
    },
    [{ mmsi: 1, name: 'BALTIC', shipType: 70 }],
  );
  assert.equal(ships[0].properties.name, 'BALTIC');
  assert.equal(ships[0].properties.type, 'Cargo');
  assert.equal(ships[0].properties.status, 'Moored');
  assert.equal(
    ships[0].properties.heading,
    90,
    '511 = unavailable, falls back to course',
  );

  const emsc = emscFeatures({
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [10, 20, -5] },
        properties: { mag: 4.2, flynn_region: 'X', unid: 'u1' },
      },
    ],
  });
  assert.deepEqual(emsc[0].geometry.coordinates, [10, 20]);
  assert.match(emsc[0].properties.link, /unid=u1$/);
  assert.equal(
    geonetFeatures({
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [175, -41] },
          properties: { magnitude: 3.14159, publicID: 'p' },
        },
      ],
    })[0].properties.magnitude,
    3.1,
  );

  const spc = spcReportFeatures(
    'Time,F_Scale,Location,County,State,Lat,Lon,Comments\n1200,UNK,TOWN,CNTY,OK,35,-97,note\nTime,Size,Location,County,State,Lat,Lon,Comments\n1300,175,B,C,TX,33,-98,x\n',
  );
  assert.deepEqual(
    spc.map((f) => f.properties.kind),
    ['Tornado', 'Hail'],
  );
  assert.equal(spc[1].properties.magnitude, '1.75 in');

  const fireballs = fireballFeatures({
    fields: [
      'date',
      'energy',
      'impact-e',
      'lat',
      'lat-dir',
      'lon',
      'lon-dir',
      'alt',
      'vel',
    ],
    data: [
      ['2026-01-01', '5', '0.2', '10', 'S', '20', 'W', '30', '15'],
      ['2026-01-02', '1', '0.1', null, null, null, null, null, null],
    ],
  });
  assert.equal(fireballs.length, 1);
  assert.deepEqual(fireballs[0].geometry.coordinates, [-20, -10]);

  const ioda = iodaOutageFeatures(countries, {
    data: [
      {
        entity: { code: 'FR', type: 'country' },
        scores: { overall: 5000, 'bgp.median': 5000 },
        event_cnt: 2,
      },
    ],
  });
  assert.equal(ioda.length, 1);
  assert.equal(ioda[0].properties.severity, 4);
  assert.equal(ioda[0].properties.signals, 'bgp');

  const inat = inatFeatures({
    results: [
      {
        geojson: { type: 'Point', coordinates: [1, 2] },
        taxon: {
          name: 'Sciurus',
          preferred_common_name: 'Squirrel',
          iconic_taxon_name: 'Mammalia',
        },
        photos: [{ url: 'https://x/square.jpg' }],
        uri: 'https://inat/1',
      },
      { geojson: { type: 'Point', coordinates: [1, 2] }, obscured: true },
    ],
  });
  assert.equal(inat.length, 1, 'obscured observations are dropped');
  assert.equal(inat[0].properties.photo, 'https://x/medium.jpg');

  assert.equal(
    peeringdbFeatures({
      data: [
        { id: 1, name: 'DC', latitude: 1, longitude: 2, status: 'ok' },
        { id: 2, latitude: null, longitude: null },
      ],
    }).length,
    1,
  );
  assert.equal(
    citybikesFeatures({
      networks: [
        {
          name: 'Bikes',
          location: { latitude: 1, longitude: 2, city: 'C' },
          company: ['A', 'B'],
        },
      ],
    })[0].properties.operator,
    'A, B',
  );
  assert.equal(
    windyWebcamFeatures({
      webcams: [
        {
          webcamId: 7,
          title: 'Cam',
          status: 'active',
          location: { latitude: 1, longitude: 2 },
          images: { current: { preview: 'https://img' } },
        },
      ],
    })[0].properties.link,
    'https://www.windy.com/webcams/7',
  );
});

test('the tile relay validates addresses and keeps keys server-side', async () => {
  assert.equal(parseTilePath('/owm-clouds/3/2/1.png').z, 3);
  assert.equal(parseTilePath('/owm-clouds/12/0/0'), null, 'beyond max zoom');
  assert.equal(parseTilePath('/owm-clouds/2/4/0'), null, 'x out of range');
  assert.equal(parseTilePath('/evil/1/0/0'), null);
  assert.equal(parseTilePath('/../owm-clouds/1/0/0'), null);

  const urls = [];
  const service = createOverlayTileService({
    env: { OWM_API_KEY: 'k123' },
    fetchImpl: async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    },
  });
  const tile = await service.tile(parseTilePath('/owm-clouds/1/0/0'));
  assert.equal(tile.status, 200);
  assert.match(
    urls[0],
    /^https:\/\/tile\.openweathermap\.org\/map\/clouds_new\/1\/0\/0\.png\?appid=k123$/,
  );
  await service.tile(parseTilePath('/owm-clouds/1/0/0'));
  assert.equal(urls.length, 1, 'served from cache');
  assert.equal(
    (await service.tile(parseTilePath('/waqi-aqi/1/0/0'))).status,
    404,
    'missing key',
  );
  assert.equal(service.keys().WAQI_TOKEN, false);
  assert.equal(service.keys().OWM_API_KEY, true);
  assert.ok(
    !JSON.stringify(service.keys()).includes('k123'),
    'status never carries values',
  );

  assert.deepEqual(
    latestRainViewerFrame({
      host: 'https://tilecache.rainviewer.com',
      radar: {
        past: [
          { time: 1, path: '/v2/radar/a' },
          { time: 2, path: '/v2/radar/b' },
        ],
      },
    }),
    { host: 'https://tilecache.rainviewer.com', path: '/v2/radar/b', time: 2 },
  );
  assert.equal(
    latestRainViewerFrame({
      host: 'https://evil.example/x',
      radar: { past: [{ path: '/v2/radar/a' }] },
    }),
    null,
  );
});

test('world stats batch indicators and survive a missing Wikipedia page', async () => {
  const seen = [];
  const service = createWorldStatsService({
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.includes('wikipedia'))
        return { ok: false, status: 404, json: async () => ({}) };
      if (/country\/JPN\?format/.test(url))
        return {
          ok: true,
          json: async () => [
            {},
            [
              {
                name: 'Japan',
                capitalCity: 'Tokyo',
                region: { value: 'East Asia ' },
                incomeLevel: { value: 'High income' },
                latitude: '35.6',
                longitude: '139.7',
              },
            ],
          ],
        };
      return {
        ok: true,
        json: async () => [
          {},
          [{ indicator: { id: 'SP.POP.TOTL' }, value: 1, date: '2025' }],
        ],
      };
    },
  });
  const japan = await service.country('JPN');
  assert.equal(japan.capital, 'Tokyo');
  assert.equal(japan.region, 'East Asia');
  assert.equal(japan.wiki, null);
  assert.ok(
    seen
      .filter((u) => u.includes('/indicator/'))
      .every((u) => u.split(';').length <= 50),
  );
});
