import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_NOTIFY_ASTROS_URL,
  CORQUAID_PEOPLE_URL,
  STATION_NORAD,
  normalizeCraft,
  parseOpenNotify,
  parseCorquaid,
  crewCounts,
  validateCrewSnapshot,
} from './records.js';
import { crewProxy } from '../../../server/providers/space/crew.js';
import { stationRecordsFromTle, CREWED_STATIONS } from './index.js';
import { ISS_L1, ISS_L2 } from '../../testSupport/spaceTle.mjs';

// Shapes follow the public feeds' documented formats; names are placeholders.
const openNotify = {
  message: 'success',
  number: 4,
  people: [
    { name: 'Astronaut A', craft: 'ISS' },
    { name: 'Astronaut B', craft: 'ISS' },
    { name: 'Taikonaut C', craft: 'Tiangong' },
    { name: '<>', craft: 'ISS' },
  ],
};
const corquaid = {
  number: 3,
  iss_expedition: 74,
  people: [
    {
      id: 1,
      name: 'Astronaut A',
      agency: 'NASA',
      position: 'Commander',
      spacecraft: 'Crew Dragon',
      launched: 1_780_000_000,
      iss: true,
      image: 'https://example/x.jpg',
      instagram: 'x',
    },
    {
      id: 2,
      name: 'Taikonaut C',
      agency: 'CMSA',
      position: 'Commander',
      spacecraft: 'Shenzhou 22',
      launched: 1_780_000_000,
      iss: false,
    },
    {
      id: 3,
      name: 'Private D',
      agency: 'Axiom',
      spacecraft: 'Crew Dragon Free Flyer',
      iss: false,
    },
  ],
};

test('craft names map onto the two drawn stations', () => {
  assert.equal(normalizeCraft('ISS'), 'ISS');
  assert.equal(normalizeCraft('anything', true), 'ISS');
  assert.equal(normalizeCraft('Tiangong'), 'Tiangong');
  assert.equal(normalizeCraft('Shenzhou 22'), 'Tiangong');
  assert.equal(
    normalizeCraft('Crew Dragon Free Flyer'),
    'Crew Dragon Free Flyer',
  );
  assert.equal(normalizeCraft(''), null);
  assert.equal(STATION_NORAD.ISS, 25544);
  assert.equal(STATION_NORAD.TIANGONG, 48274);
});

test('Open Notify and corquaid rosters parse to public mission roles only', () => {
  const a = parseOpenNotify(openNotify);
  assert.deepEqual(crewCounts(a), { ISS: 2, Tiangong: 1 });
  assert.equal(parseOpenNotify({ message: 'failure', people: [] }), null);
  const b = parseCorquaid(corquaid);
  assert.deepEqual(crewCounts(b), {
    ISS: 1,
    Tiangong: 1,
    'Crew Dragon Free Flyer': 1,
  });
  assert.equal(b[0].launchedAt, 1_780_000_000_000);
  assert.ok(
    !('image' in b[0]) && !('instagram' in b[0]),
    'images and social links are dropped',
  );
  assert.equal(parseCorquaid({}), null);
});

test('browser validation recomputes counts and flags an empty roster', () => {
  const snap = validateCrewSnapshot({
    schemaVersion: 1,
    source: 'Open Notify (community)',
    fetchedAt: 1,
    people: parseOpenNotify(openNotify),
  });
  assert.equal(snap.counts.ISS, 2);
  assert.equal(snap.unavailable, false);
  assert.equal(
    validateCrewSnapshot({ schemaVersion: 1, people: [] }).unavailable,
    true,
  );
  assert.throws(() => validateCrewSnapshot(null), /Malformed/);
});

function install(fetchImpl) {
  let handler;
  crewProxy({ fetchImpl, now: () => 1000 }).configureServer({
    middlewares: { use: (_p, fn) => (handler = fn) },
  });
  return async () => {
    let body;
    await handler(
      { method: 'GET', url: '/' },
      { writeHead() {}, end: (t) => (body = JSON.parse(t)) },
    );
    return body;
  };
}
const json = (value) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  text: async () => JSON.stringify(value),
  body: null,
});

test('crew provider prefers corquaid and falls back to Open Notify', async () => {
  const calls = [];
  let body = await install(async (url) => {
    calls.push(url);
    return json(corquaid);
  })();
  assert.equal(body.source, 'corquaid ISS APIs (community)');
  assert.deepEqual(calls, [CORQUAID_PEOPLE_URL]);

  calls.length = 0;
  body = await install(async (url) => {
    calls.push(url);
    if (url === CORQUAID_PEOPLE_URL) throw new Error('down');
    return json(openNotify);
  })();
  assert.equal(body.source, 'Open Notify (community)');
  assert.deepEqual(calls, [CORQUAID_PEOPLE_URL, OPEN_NOTIFY_ASTROS_URL]);
  assert.equal(body.people.length, 3);

  body = await install(async () => {
    throw new Error('offline');
  })();
  assert.equal(body.unavailable, true);
  assert.deepEqual(body.people, []);
});

test('station TLEs are picked out of the stations group', () => {
  const css = [
    ISS_L1.replace('25544U', '48274U'),
    ISS_L2.replace('25544 ', '48274 '),
  ];
  const text = [
    'ISS (ZARYA)',
    ISS_L1,
    ISS_L2,
    'CSS (TIANHE)',
    ...css,
    'OTHER',
    ISS_L1.replace('25544U', '11111U'),
    ISS_L2.replace('25544 ', '11111 '),
  ].join('\n');
  const records = stationRecordsFromTle(text);
  assert.deepEqual(
    records.map((r) => [r.norad, r.station.key]),
    [
      [25544, 'ISS'],
      [48274, 'Tiangong'],
    ],
  );
  assert.equal(CREWED_STATIONS.length, 2);
  assert.deepEqual(stationRecordsFromTle(''), []);
});
