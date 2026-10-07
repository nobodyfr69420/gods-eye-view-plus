import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPACE_TRACK_LOGIN_URL,
  SPACE_TRACK_TIP_QUERY,
  DECAY_WATCH_GROUPS,
  parseSpaceTrackTime,
  parseTipMessages,
  parseSatcatNames,
  decayWatchCandidates,
  validateReentrySnapshot,
  spaceTrackSatcatQuery,
} from './records.js';
import {
  reentriesProxy,
  spaceTrackCredentials,
} from '../../../server/providers/space/reentries.js';
import { describeTip } from './index.js';
import { SATELLITE_GROUP_NAMES, tleEpochMs } from '../satelliteGroups/model.js';
import { ISS_L1, ISS_L2 } from '../../testSupport/spaceTle.mjs';

const NOW = Date.UTC(2026, 9, 7, 12);
// Rows follow Space-Track's documented TIP field names; values are fixtures.
const tips = [
  {
    NORAD_CAT_ID: '60001',
    MSG_EPOCH: '2026-10-07 06:00:00',
    DECAY_EPOCH: '2026-10-08 14:30:00',
    WINDOW: '120',
    LAT: '-12.5',
    LON: '200.0',
    DIRECTION: 'ascending',
    INCL: '53.2',
    HIGH_INTEREST: 'N',
  },
  {
    NORAD_CAT_ID: '60001',
    MSG_EPOCH: '2026-10-06 06:00:00',
    DECAY_EPOCH: '2026-10-09 00:00:00',
    WINDOW: '600',
    LAT: '0',
    LON: '0',
  },
  {
    NORAD_CAT_ID: '50002',
    MSG_EPOCH: '2026-10-07 01:00:00',
    DECAY_EPOCH: '2026-10-07 05:00:00',
    WINDOW: '30',
    LAT: '30',
    LON: '-40',
    HIGH_INTEREST: 'Y',
  },
  {
    NORAD_CAT_ID: '40003',
    MSG_EPOCH: '2026-10-01 01:00:00',
    DECAY_EPOCH: '2026-10-02 05:00:00',
    WINDOW: '30',
  },
  { NORAD_CAT_ID: 'x', DECAY_EPOCH: 'soon' },
];

test('TIP parsing keeps the latest message per object, upcoming or decayed < 24 h', () => {
  assert.equal(parseSpaceTrackTime('2026-10-07 12:00:00'), NOW);
  const parsed = parseTipMessages(tips, NOW);
  assert.deepEqual(
    parsed.map((t) => t.norad),
    [50002, 60001],
  );
  const next = parsed[1];
  assert.equal(next.windowMin, 120);
  assert.equal(next.longitude, -160, 'longitude normalized to −180..180');
  assert.equal(next.decayAt, Date.UTC(2026, 9, 8, 14, 30));
  assert.equal(parsed[0].highInterest, true);
  assert.equal(parseTipMessages({}, NOW), null);
  assert.match(describeTip(next, NOW), /^10-08 14:30 UTC ±2 h · in 26\.5 h$/);
  assert.match(describeTip(parsed[0], NOW), /predicted 7 h ago/);
  const names = parseSatcatNames([
    {
      NORAD_CAT_ID: '60001',
      OBJECT_NAME: 'CZ-5B R/B',
      OBJECT_TYPE: 'ROCKET BODY',
      COUNTRY: 'PRC',
    },
  ]);
  assert.deepEqual(names.get(60001), {
    name: 'CZ-5B R/B',
    objectType: 'ROCKET BODY',
    country: 'PRC',
  });
  assert.match(
    spaceTrackSatcatQuery([1, 2]),
    /NORAD_CAT_ID\/1,2\/format\/json$/,
  );
});

test('decay watch flags only low-perigee objects with recent TLEs', () => {
  for (const group of DECAY_WATCH_GROUPS)
    assert.ok(
      SATELLITE_GROUP_NAMES.includes(group),
      `${group} is readable through the group source`,
    );
  const low = (norad, mm) => [
    `LOW ${norad}`,
    ISS_L1.replace('25544U', `${norad}U`),
    ISS_L2.replace('25544 ', `${norad} `).replace('15.72125391', mm),
  ];
  const text = [
    ...low(11111, '16.40000000'),
    ...low(22222, '16.30000000'),
    ...low(33333, '16.10000000'),
    'ISS',
    ISS_L1,
    ISS_L2,
  ].join('\n');
  const epoch = tleEpochMs(ISS_L1);
  const watch = decayWatchCandidates({ starlink: text }, epoch + 86_400_000);
  assert.deepEqual(
    watch.map((w) => w.norad),
    [11111, 22222],
    'lowest perigee first',
  );
  assert.ok(watch.every((w) => w.perigeeKm < 200));
  assert.deepEqual(
    decayWatchCandidates({ starlink: text }, epoch + 60 * 86_400_000),
    [],
    'month-old TLEs of decaying objects are dropped as probably re-entered',
  );
});

test('browser validation and provider without credentials', async () => {
  assert.equal(spaceTrackCredentials({}), null);
  assert.deepEqual(
    spaceTrackCredentials({
      SPACETRACK_IDENTITY: 'a',
      SPACETRACK_PASSWORD: 'b',
    }),
    { identity: 'a', password: 'b' },
  );
  let calls = 0;
  const body = await call(
    reentriesProxy({ env: {}, fetchImpl: async () => calls++ }),
  );
  assert.equal(calls, 0, 'no upstream request without credentials');
  assert.equal(body.configured, false);
  const snap = validateReentrySnapshot(body);
  assert.equal(snap.configured, false);
  assert.deepEqual(snap.tips, []);
  assert.throws(() => validateReentrySnapshot({}), /Malformed/);
});

async function call(plugin) {
  let handler;
  plugin.configureServer({ middlewares: { use: (_p, fn) => (handler = fn) } });
  let body;
  await handler(
    { method: 'GET', url: '/' },
    { writeHead() {}, end: (t) => (body = JSON.parse(t)) },
  );
  return body;
}

test('provider logs in per query, names TIP objects and never leaks credentials', async () => {
  const requests = [];
  const plugin = reentriesProxy({
    env: {
      SPACETRACK_IDENTITY: 'user@example.org',
      SPACETRACK_PASSWORD: 'secret',
    },
    now: () => NOW,
    fetchImpl: async (url, init) => {
      const form = new URLSearchParams(init.body);
      requests.push({ url, method: init.method, query: form.get('query') });
      const payload =
        form.get('query') === SPACE_TRACK_TIP_QUERY
          ? tips
          : [{ NORAD_CAT_ID: '60001', OBJECT_NAME: 'CZ-5B R/B' }];
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(payload),
        body: null,
      };
    },
  });
  const body = await call(plugin);
  assert.equal(body.configured, true);
  assert.equal(body.tips.length, 2);
  assert.equal(body.tips.find((t) => t.norad === 60001).name, 'CZ-5B R/B');
  assert.ok(
    requests.every(
      (r) => r.url === SPACE_TRACK_LOGIN_URL && r.method === 'POST',
    ),
  );
  assert.equal(requests.length, 2);
  assert.ok(!JSON.stringify(body).includes('secret'));
  await call(plugin);
  assert.equal(requests.length, 2, 'cached for an hour');

  const failed = await call(
    reentriesProxy({
      env: { SPACETRACK_IDENTITY: 'u', SPACETRACK_PASSWORD: 'p' },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => '{"Login":"Failed"}',
        body: null,
      }),
    }),
  );
  assert.equal(failed.unavailable, true);
  assert.match(failed.reason, /login failed/);
});
