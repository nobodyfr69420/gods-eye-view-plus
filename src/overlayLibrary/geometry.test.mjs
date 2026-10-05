import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angularDistance,
  antipodeFeature,
  destination,
  graticuleFeatures,
  horizonDistanceM,
  keyParallelFeatures,
  maidenheadLocator,
  moonPhaseName,
  rasterizeSolar,
  nightShade,
  solarElevation,
  splitAtAntimeridian,
  sublunarPoint,
  subsolarPoint,
  twilightFeature,
  utmFeatures,
} from './computedGeometry.js';
import {
  clipRingToRect,
  ringArea,
  safeLinePaths,
  tilePolygon,
} from './geometryTools.js';
import {
  colorFromStops,
  featureColor,
  featureSize,
  formatBytes,
  formatCount,
  formatValue,
  parseHex,
} from './style.js';
import {
  lonLatToTile,
  matchesOsmFilter,
  ringCentroid,
  tilesAround,
  zoomForAltitude,
} from './osmTiles.js';
import { feedUrl } from './feedClient.js';
import { kpLevel, summarizeFeatures } from './stats.js';

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('sub-solar point matches the June solstice and the equation of time', () => {
  const june = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
  near(june.lat, 23.44, 0.05, 'solstice declination');
  near(june.lon, 0.4, 0.6, 'solstice longitude');
  const october = subsolarPoint(new Date('2026-10-05T05:00:00Z'));
  near(october.lat, -4.6, 0.2, 'October declination');
  near(october.lon, 102.2, 0.6, 'October longitude');
  near(
    solarElevation(october.lat, october.lon, new Date('2026-10-05T05:00:00Z')),
    90,
    0.01,
    'overhead',
  );
});

test('moon phase is classified from the illuminated fraction', () => {
  const moon = sublunarPoint(new Date('2026-10-05T05:00:00Z'));
  assert.equal(moonPhaseName(moon.phase, moon.fraction), 'Waning Crescent');
  assert.equal(moonPhaseName(0.5, 1), 'Full Moon');
  assert.equal(moonPhaseName(0.01, 0.001), 'New Moon');
  near(moon.distanceKm, 375000, 20000, 'lunar distance');
});

test('great-circle helpers are consistent', () => {
  const [lon, lat] = destination(0, 0, 90, 90);
  near(lon, 90, 1e-6, 'east 90°');
  near(lat, 0, 1e-6, 'stays on equator');
  near(angularDistance(0, 0, 0, 90), 90, 1e-9, 'distance');
  near(horizonDistanceM(10_000) / 1000, 357, 1, 'horizon at 10 km');
  const anti = antipodeFeature(30, -97);
  assert.deepEqual(anti.geometry.coordinates, [83, -30]);
  assert.equal(
    splitAtAntimeridian([
      [170, 0],
      [179, 0],
      [-179, 0],
      [-170, 0],
    ]).length,
    2,
  );
});

test('terminator and twilight circles stay at the right solar angle', () => {
  const date = new Date('2026-03-20T12:00:00Z');
  for (const depression of [0, 6, 18]) {
    const feature = twilightFeature(date, depression);
    const coords =
      feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat();
    for (const [lon, lat] of coords.filter((_, i) => i % 20 === 0))
      near(
        solarElevation(lat, lon, date),
        -depression,
        0.05,
        `elevation on ${depression}° line`,
      );
  }
});

test('grids have the expected structure', () => {
  assert.equal(graticuleFeatures(10).length, 36 + 17);
  assert.equal(keyParallelFeatures(new Date('2026-01-01T00:00:00Z')).length, 5);
  const utm = utmFeatures();
  const labels = utm
    .filter((f) => f.properties.label)
    .map((f) => f.properties.name);
  assert.ok(labels.includes('33T'));
  assert.ok(labels.includes('32V'));
  assert.ok(!labels.includes('32X'), 'Svalbard exception removes 32X');
  assert.equal(maidenheadLocator(30.27, -97.74), 'EM10dg');
  assert.equal(maidenheadLocator(51.5, -0.12), 'IO91wm');
});

test('night raster is transparent by day and dark at night', () => {
  const pixels = rasterizeSolar(
    36,
    18,
    new Date('2026-03-20T12:00:00Z'),
    nightShade,
  );
  const alphaAt = (lon, lat) => {
    const x = Math.floor(((lon + 180) / 360) * 36);
    const y = Math.floor(((90 - lat) / 180) * 18);
    return pixels[(y * 36 + x) * 4 + 3];
  };
  assert.equal(alphaAt(0, 0), 0, 'noon at Greenwich is lit');
  assert.ok(alphaAt(179, 0) > 150, 'midnight on the antimeridian is dark');
});

test('polygon tiling clips large shapes into ≤30° pieces and keeps small ones', () => {
  const small = [
    [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
      [0, 0],
    ],
  ];
  assert.deepEqual(tilePolygon(small), [small]);
  const strip = [
    [
      [-7.5, -90],
      [7.5, -90],
      [7.5, 90],
      [-7.5, 90],
      [-7.5, -90],
    ],
  ];
  const pieces = tilePolygon(strip);
  assert.ok(pieces.length >= 6);
  for (const [outer] of pieces) {
    for (const [, lat] of outer) assert.ok(Math.abs(lat) <= 85 + 1e-9);
    assert.ok(Math.abs(ringArea(outer)) > 0);
  }
  const clipped = clipRingToRect(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [5, 5, 20, 20],
  );
  near(Math.abs(ringArea(clipped)), 25, 1e-9, 'clipped area');
});

test('ground line paths drop polar vertices and split at the antimeridian', () => {
  const parts = safeLinePaths([
    [-10, 80],
    [-10, 89],
    [0, 90],
    [10, 89],
    [10, 80],
    [170, 0],
    [-170, 0],
  ]);
  assert.equal(parts.length, 1, 'only the (0..10, 80) segment remains a path');
  assert.deepEqual(
    safeLinePaths([
      [0, 0],
      [0, 0],
    ]),
    [],
  );
});

test('style helpers resolve colors, sizes and formats', () => {
  assert.deepEqual(parseHex('#ff0000'), [1, 0, 0, 1]);
  assert.deepEqual(
    colorFromStops(
      [
        [0, '#000000'],
        [10, '#ffffff'],
      ],
      5,
    ).map((v) => Math.round(v * 100) / 100),
    [0.5, 0.5, 0.5, 1],
  );
  assert.deepEqual(
    featureColor(
      { color: '#000000', colorBy: { prop: 'a', map: { x: '#ffffff' } } },
      { a: 'x' },
    ),
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    featureColor(
      { color: '#000000', colorBy: { prop: 'fill', direct: true } },
      { fill: 'red' },
    ),
    [0, 0, 0, 1],
  );
  assert.equal(
    featureSize(
      { sizeBy: { prop: 'm', domain: [0, 10], range: [4, 14] } },
      { m: 5 },
    ),
    9,
  );
  assert.equal(formatValue(1234.5, 'mw'), '1,234.5 MW');
  assert.equal(formatValue('javascript:x', 'link'), null);
  assert.equal(formatValue(1791177783743, 'time'), '2026-10-05 05:23 UTC');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatCount(12345), '12K');
});

test('vector-tile helpers pick tiles and match filters', () => {
  assert.deepEqual(lonLatToTile(0, 0, 1), { x: 1, y: 1 });
  assert.equal(zoomForAltitude(10_000), 14);
  assert.ok(zoomForAltitude(1_000_000) < 9);
  const tiles = tilesAround(-97.74, 30.27, 14, 5000, 9);
  assert.equal(tiles.length, 9);
  assert.equal(new Set(tiles.map((t) => t.key)).size, 9);
  assert.ok(
    matchesOsmFilter(
      { class: ['office'], subclass: ['diplomatic'] },
      { class: 'office', subclass: 'diplomatic' },
    ),
  );
  assert.ok(
    !matchesOsmFilter(
      { class: ['office'], subclass: ['diplomatic'] },
      { class: 'office', subclass: 'lawyer' },
    ),
  );
  assert.ok(
    matchesOsmFilter({ where: { admin_level: [2, 4] } }, { admin_level: 2 }),
  );
  assert.deepEqual(
    ringCentroid([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]),
    [1, 1],
  );
});

test('feed URLs are encoded and stats summaries rank groups', () => {
  assert.equal(
    feedUrl('awc-metars', {
      bbox: { west: -98, south: 30, east: -97, north: 31 },
    }),
    '/api/overlay-feed/awc-metars?bbox=-98.000%2C30.000%2C-97.000%2C31.000',
  );
  const summary = summarizeFeatures(
    [
      { properties: { c: 'A', v: 1 } },
      { properties: { c: 'A', v: 3 } },
      { properties: { c: 'B', v: 2 } },
      { properties: {} },
    ],
    { by: 'c', value: 'v' },
  );
  assert.deepEqual(
    summary.groups.map((g) => [g.key, g.count]),
    [
      ['A', 2],
      ['B', 1],
      ['Unknown', 1],
    ],
  );
  assert.equal(summary.values.p50, 2);
  assert.equal(summary.values.sum, 6);
  assert.equal(kpLevel(5.3).label, 'G1 minor storm');
  assert.equal(kpLevel(2).status, 'good');
});
