import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SATELLITE_GROUP_CATEGORIES,
  SATELLITE_GROUP_NAMES,
  defaultSatelliteGroupCategories,
  normalizeSatelliteGroupCategories,
  tleOrbitSummary,
  tleEpochMs,
  tleExponentField,
  orbitShape,
  orbitRegime,
  footprintRadiusKm,
  footprintRing,
  destinationPoint,
  greatCircleKm,
  groundTrackSampleTimes,
  tleAgeLabel,
} from './model.js';
import {
  buildSatelliteGroupRecords,
  countByCategory,
  satelliteGroupAnalystRecord,
} from './records.js';
import { createSatelliteGroupSource } from './source.js';
import {
  nextPasses,
  describePass,
  compassPoint,
  observerKey,
  cameraObserver,
} from './passes.js';
import { satrecFromTle, propagateGeodetic } from './rendering.js';

import { ISS_L1, ISS_L2 } from '../../testSupport/spaceTle.mjs';
const tle = (name, norad, meanMotion = '15.72125391') =>
  [
    name,
    ISS_L1.replace('25544U', `${String(norad).padStart(5, '0')}U`),
    ISS_L2.replace('25544 ', `${String(norad).padStart(5, '0')} `).replace(
      '15.72125391',
      meanMotion,
    ),
  ].join('\n');

test('category table covers every requested public CelesTrak family once', () => {
  const ids = SATELLITE_GROUP_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const required of [
    'starlink',
    'oneweb',
    'gnss',
    'weather',
    'science',
    'stations',
    'amateur',
    'military',
    'debris',
  ])
    assert.ok(ids.includes(required), required);
  for (const group of SATELLITE_GROUP_NAMES)
    assert.match(group, /^[a-z0-9-]+$/i, 'proxy accepts the group name');
  assert.ok(
    SATELLITE_GROUP_CATEGORIES.find((c) => c.id === 'debris').groups.length >=
      4,
  );
  const defaults = defaultSatelliteGroupCategories();
  assert.ok(!defaults.includes('starlink'), 'heavy shells are opt-in');
  assert.ok(!defaults.includes('debris'));
  assert.deepEqual(
    normalizeSatelliteGroupCategories(['debris', 'nope', 'gnss']),
    ['debris', 'gnss'],
  );
  assert.deepEqual(normalizeSatelliteGroupCategories(null), defaults);
});

test('TLE mean elements give the ISS orbit shape', () => {
  const s = tleOrbitSummary(ISS_L1, ISS_L2);
  assert.equal(s.norad, 25544);
  assert.equal(s.inclinationDeg, 51.6416);
  assert.equal(s.eccentricity, 0.0006703);
  assert.ok(Math.abs(s.periodMin - 91.6) < 0.1, s.periodMin);
  assert.ok(s.perigeeKm > 330 && s.perigeeKm < 360, s.perigeeKm);
  assert.ok(s.apogeeKm > s.perigeeKm);
  assert.equal(s.regime, 'LEO');
  assert.equal(
    new Date(tleEpochMs(ISS_L1)).toISOString().slice(0, 10),
    '2008-09-20',
  );
  assert.ok(Math.abs(tleExponentField('-11606-4') - -0.11606e-4) < 1e-12);
  assert.equal(tleOrbitSummary('garbage', ISS_L2), null);
});

test('orbit regimes and footprint geometry', () => {
  const geo = orbitShape(1.0027, 0.0002);
  assert.ok(Math.abs(geo.perigeeKm - 35786) < 30, geo.perigeeKm);
  assert.equal(orbitRegime({ ...geo, eccentricity: 0.0002 }), 'GEO');
  assert.equal(
    orbitRegime({ ...orbitShape(2.0056, 0.01), eccentricity: 0.01 }),
    'MEO',
  );
  assert.equal(
    orbitRegime({ ...orbitShape(2.006, 0.7), eccentricity: 0.7 }),
    'HEO',
  );
  // ISS at ~420 km sees ~2,250 km to the horizon and ~1,400 km above 10°.
  const horizon = footprintRadiusKm(420, 0);
  const mask = footprintRadiusKm(420, 10);
  assert.ok(horizon > 2200 && horizon < 2350, horizon);
  assert.ok(mask > 1300 && mask < 1500, mask);
  assert.equal(footprintRadiusKm(0, 0), 0);
  // GEO covers ~81° of central angle.
  assert.ok(Math.abs(footprintRadiusKm(35786, 0) / 111.19 - 81.3) < 0.5);
  const ring = footprintRing(10, 20, 1000, 36);
  assert.equal(ring.length, 37);
  for (const p of ring)
    assert.ok(
      Math.abs(greatCircleKm(10, 20, p.latitude, p.longitude) - 1000) < 1,
    );
  const wrapped = destinationPoint(0, 179, 90, 300);
  assert.ok(
    wrapped.longitude < -170,
    'longitude wraps across the antimeridian',
  );
});

test('ground-track sampling spans −½ to +1 orbit and caps slow orbits at a day', () => {
  const now = Date.UTC(2026, 9, 7);
  const times = groundTrackSampleTimes(now, 92);
  assert.equal(times[0], now - 46 * 60_000);
  assert.equal(times.at(-1), now + 92 * 60_000);
  const geo = groundTrackSampleTimes(now, 1436);
  assert.ok(geo.at(-1) - geo[0] <= 1.5 * 1440 * 60_000);
  assert.deepEqual(groundTrackSampleTimes(NaN, 90), []);
  assert.equal(tleAgeLabel(now - 5 * 3_600_000, now), 'TLE 5 h old');
  assert.equal(tleAgeLabel(now - 4 * 86_400_000, now), 'TLE 4 d old');
});

test('records dedupe by NORAD with the first category winning', () => {
  const texts = new Map([
    ['stations', tle('ISS (ZARYA)', 25544)],
    ['science', [tle('ISS AGAIN', 25544), tle('HUBBLE', 20580)].join('\n')],
    ['geodetic', 'not a tle'],
  ]);
  const records = buildSatelliteGroupRecords(texts, ['science', 'stations']);
  assert.deepEqual(
    records.map((r) => [r.norad, r.category, r.name]),
    [
      [25544, 'stations', 'ISS (ZARYA)'],
      [20580, 'science', 'HUBBLE'],
    ],
  );
  assert.deepEqual(countByCategory(records), { stations: 1, science: 1 });
  assert.deepEqual(buildSatelliteGroupRecords(texts, []), []);
  const analyst = satelliteGroupAnalystRecord(records[0], {
    latitude: 1,
    longitude: 2,
    altitude: 420_000,
  });
  assert.equal(analyst.id, '25544');
  assert.equal(analyst.altitudeKm, 420);
  assert.equal(analyst.regime, 'LEO');
});

test('group source reads only table groups and reports cache age', async () => {
  const calls = [];
  const source = createSatelliteGroupSource({
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => tle('X', 1),
        headers: new Map([
          ['x-tle-cache', 'STALE-ERROR'],
          ['x-tle-fetched-at', '2026-10-07T00:00:00.000Z'],
        ]),
      };
    },
  });
  const result = await source.readGroup('iridium-NEXT');
  assert.deepEqual(calls, ['/api/celestrak/iridium-NEXT']);
  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
  assert.equal(result.fetchedAt, Date.parse('2026-10-07T00:00:00.000Z'));
  await assert.rejects(source.readGroup('../etc'), /Unknown satellite group/);
  const error = createSatelliteGroupSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>error</html>',
      headers: new Map(),
    }),
  });
  assert.equal(
    (await error.readGroup('gnss')).ok,
    false,
    'an error page is not a catalog',
  );
});

test('SGP4 propagation and next passes over an observer', () => {
  const satrec = satrecFromTle(ISS_L1, ISS_L2);
  assert.ok(satrec);
  const epoch = tleEpochMs(ISS_L1);
  const pos = propagateGeodetic(satrec, new Date(epoch));
  assert.ok(pos.altitude > 300_000 && pos.altitude < 400_000, pos.altitude);
  assert.ok(Math.abs(pos.latitude) <= 51.7);
  assert.ok(pos.speedMps > 7500 && pos.speedMps < 7800);
  assert.equal(satrecFromTle('1 bad', '2 bad'), null);

  const passes = nextPasses(satrec, {
    latDeg: 40,
    lonDeg: -100,
    fromMs: epoch,
    count: 3,
  });
  assert.ok(passes.length >= 1, 'a 51.6° orbit passes over 40°N within a day');
  for (let i = 0; i < passes.length; i++) {
    assert.ok(passes[i].setMs > passes[i].riseMs);
    assert.ok(passes[i].maxElevDeg >= 10);
    if (i) assert.ok(passes[i].riseMs > passes[i - 1].setMs);
  }
  assert.match(
    describePass(passes[0], passes[0].riseMs - 10 * 60_000),
    /^in 10 min · rise [NESW]{1,2} · max \d+°/,
  );
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(225), 'SW');
  assert.equal(observerKey({ latDeg: 40.12, lonDeg: -99.9 }), '40,-100');
  assert.deepEqual(
    cameraObserver({
      camera: {
        positionCartographic: {
          latitude: Math.PI / 4,
          longitude: -Math.PI / 2,
        },
      },
    }),
    { latDeg: 45, lonDeg: -90 },
  );
  assert.equal(cameraObserver({}), null);
});
