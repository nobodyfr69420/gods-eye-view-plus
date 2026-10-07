import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SWPC_URLS,
  OVATION_CELLS,
  parseSwpcTime,
  swpcRows,
  kpToGScale,
  parseKpProduct,
  parseKpEstimate,
  parseSolarWind,
  flareClass,
  xrayToRScale,
  parseXray,
  alertHeadline,
  parseAlerts,
  parseScales,
  parseOvation,
  ovationProbabilityAt,
  validateSpaceWeatherSnapshot,
} from './records.js';
import {
  createSpaceWeatherSource,
  decodeOvationGrid,
  validateAuroraSnapshot,
} from './source.js';
import { spaceWeatherProxy } from '../../../server/providers/space/space-weather.js';
import { spaceWeatherSummaryLines, alertsInWindow, kpBand } from './model.js';
import { createSpaceWeatherLayer } from './index.js';

const T = Date.UTC(2026, 9, 7, 3, 0);

// Fixtures follow the documented SWPC shapes; they are test inputs, not data.
const kpRows = [
  ['time_tag', 'Kp', 'a_running', 'station_count'],
  ['2026-10-06 00:00:00.000', '2.33', '9', '8'],
  ['2026-10-06 21:00:00.000', '5.67', '80', '8'],
  ['2026-10-07 00:00:00.000', '4.00', '27', '8'],
];
const kpObjects = [
  { time_tag: '2026-10-06T21:00:00', Kp: 5.67, a_running: 80 },
  { time_tag: '2026-10-07T00:00:00', Kp: 4, a_running: 27 },
];
const plasma = [
  ['time_tag', 'density', 'speed', 'temperature'],
  ['2026-10-07 02:58:00.000', '4.1', '612.3', '210000'],
  ['2026-10-07 02:59:00.000', null, null, null],
];
const mag = [
  ['time_tag', 'bx_gsm', 'by_gsm', 'bz_gsm', 'lon_gsm', 'lat_gsm', 'bt'],
  ['2026-10-07 02:59:00.000', '1.2', '-3.4', '-12.5', '280', '-60', '13.6'],
];
const xray = [
  {
    time_tag: '2026-10-07T02:58:00Z',
    satellite: 19,
    flux: 2.3e-6,
    energy: '0.1-0.8nm',
  },
  {
    time_tag: '2026-10-07T01:00:00Z',
    satellite: 19,
    flux: 4.6e-5,
    energy: '0.1-0.8nm',
  },
  {
    time_tag: '2026-10-07T02:59:00Z',
    satellite: 19,
    flux: 9e-8,
    energy: '0.05-0.4nm',
  },
];
const alerts = [
  {
    product_id: 'K05W',
    issue_datetime: '2026-10-07 01:10:00.000',
    message:
      'Space Weather Message Code: WARK05\r\nSerial Number: 1\r\nIssue Time: 2026 Oct 07 0110 UTC\r\n\r\nWARNING: Geomagnetic K-index of 5 expected\r\nValid From: 2026 Oct 07 0110 UTC',
  },
  {
    product_id: 'K04A',
    issue_datetime: '2026-10-07 02:00:00.000',
    message:
      'Space Weather Message Code: ALTK04\r\n\r\nALERT: Geomagnetic K-index of 4\r\n<script>',
  },
  { product_id: 'X', issue_datetime: 'bad', message: 'ignored' },
];
const scales = {
  '-1': {
    DateStamp: '2026-10-06',
    R: { Scale: '1', Text: 'minor' },
    S: { Scale: '0', Text: 'none' },
    G: { Scale: '2', Text: 'moderate' },
  },
  0: {
    DateStamp: '2026-10-07',
    R: { Scale: '0', Text: 'none' },
    S: { Scale: '0', Text: 'none' },
    G: { Scale: '1', Text: 'minor' },
  },
};
function ovation() {
  const coordinates = [];
  for (let lon = 0; lon < 360; lon++)
    for (let lat = -90; lat <= 90; lat++)
      coordinates.push([
        lon,
        lat,
        Math.abs(lat) >= 65 && Math.abs(lat) <= 70 ? 55 : 0,
      ]);
  return {
    'Observation Time': '2026-10-07T02:50:00Z',
    'Forecast Time': '2026-10-07T03:35:00Z',
    'Data Format': '[Longitude, Latitude, Aurora]',
    coordinates,
  };
}

test('SWPC time tags and both tabular shapes parse', () => {
  assert.equal(parseSwpcTime('2026-10-07 03:00:00.000'), T);
  assert.equal(parseSwpcTime('2026-10-07T03:00:00'), T);
  assert.equal(parseSwpcTime('2026-10-07T03:00:00Z'), T);
  assert.equal(parseSwpcTime('yesterday'), null);
  assert.equal(swpcRows(kpRows).length, 3);
  assert.equal(swpcRows(kpObjects).length, 2);
  assert.deepEqual(swpcRows('nope'), []);
  for (const url of Object.values(SWPC_URLS))
    assert.ok(url.startsWith('https://services.swpc.noaa.gov/'));
});

test('Kp, G-scale and estimate', () => {
  for (const payload of [kpRows, kpObjects]) {
    const kp = parseKpProduct(payload);
    assert.deepEqual(kp.latest, { at: Date.UTC(2026, 9, 7), kp: 4 });
    assert.equal(kp.max24h, 5.67);
  }
  assert.equal(kpToGScale(4.67), 0);
  assert.equal(kpToGScale(5), 1);
  assert.equal(kpToGScale(7.33), 3);
  assert.equal(kpToGScale(9), 5);
  assert.deepEqual(
    parseKpEstimate([
      { time_tag: '2026-10-07T02:59:00', kp_index: 4, estimated_kp: 4.33 },
    ]),
    { at: Date.UTC(2026, 9, 7, 2, 59), kp: 4.33 },
  );
  assert.equal(parseKpEstimate([]), null);
});

test('solar wind keeps the latest finite row', () => {
  const wind = parseSolarWind(plasma, mag);
  assert.equal(wind.plasma.speed, 612.3);
  assert.equal(wind.plasma.at, Date.UTC(2026, 9, 7, 2, 58));
  assert.equal(wind.mag.bz, -12.5);
  assert.equal(wind.mag.bt, 13.6);
  assert.deepEqual(parseSolarWind(null, null), { plasma: null, mag: null });
});

test('GOES flare classes and R-scale', () => {
  assert.equal(flareClass(2.3e-6), 'C2.3');
  assert.equal(flareClass(4.6e-5), 'M4.6');
  assert.equal(flareClass(1.2e-4), 'X1.2');
  assert.equal(flareClass(5e-9), '<A1.0');
  assert.equal(flareClass(0), null);
  assert.equal(xrayToRScale(4.6e-5), 1);
  assert.equal(xrayToRScale(1.2e-4), 3);
  const x = parseXray(xray);
  assert.equal(x.latest.flareClass, 'C2.3');
  assert.equal(x.peak6h.flareClass, 'M4.6');
  assert.deepEqual(parseXray('x'), { latest: null, peak6h: null });
});

test('alerts are sanitized, classified and newest first', () => {
  const parsed = parseAlerts(alerts);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].kind, 'alert');
  assert.equal(parsed[0].code, 'ALTK04');
  assert.equal(parsed[0].headline, 'ALERT: Geomagnetic K-index of 4');
  assert.ok(!parsed[0].text.includes('<'), 'markup characters are stripped');
  assert.equal(parsed[1].kind, 'warning');
  assert.equal(alertHeadline('CANCEL WARNING: x').kind, 'cancel');
  assert.deepEqual(parseAlerts({}), []);
});

test('NOAA scales: current and 24 h maximum', () => {
  const s = parseScales(scales);
  assert.deepEqual(s.current.G, { scale: 1, text: 'minor' });
  assert.deepEqual(s.past24h.R, { scale: 1, text: 'minor' });
  assert.deepEqual(parseScales([]), { current: null, past24h: null });
});

test('OVATION grid round-trips through the provider encoding', () => {
  const parsed = parseOvation(ovation());
  assert.equal(parsed.cells, OVATION_CELLS);
  assert.equal(parsed.forecastAt, Date.UTC(2026, 9, 7, 3, 35));
  assert.equal(ovationProbabilityAt(parsed.grid, 67, -20), 55);
  assert.equal(ovationProbabilityAt(parsed.grid, 40, -100), 0);
  assert.equal(ovationProbabilityAt(parsed.grid, -67.4, 359.6), 55);
  const base64 = Buffer.from(parsed.grid).toString('base64');
  assert.deepEqual(decodeOvationGrid(base64), parsed.grid);
  assert.equal(decodeOvationGrid('AAAA'), null, 'wrong size is rejected');
  assert.equal(decodeOvationGrid('!!'), null);
  assert.equal(parseOvation({ coordinates: [[0, 0, 1]] }), null);
});

test('browser validation drops out-of-contract values', () => {
  const snap = validateSpaceWeatherSnapshot({
    schemaVersion: 1,
    fetchedAt: T,
    kp: {
      latest: { at: T, kp: 12 },
      series: [
        { at: T, kp: 3 },
        { at: 'x', kp: 1 },
      ],
    },
    solarWind: { plasma: { at: T, speed: 400, density: -1 } },
    xray: { latest: { at: T, flux: 1e-5 } },
    alerts: [
      { id: 'a', issuedAt: T, headline: 'h', text: 't', kind: 'alert' },
      { id: 1 },
    ],
    feeds: { kp: 'ok', xray: 'nope', evil: 'ok' },
  });
  assert.equal(snap.kp.latest, null);
  assert.equal(snap.kp.series.length, 1);
  assert.equal(snap.solarWind.plasma.density, null);
  assert.equal(snap.xray.latest.flareClass, 'M1.0');
  assert.equal(snap.alerts.length, 1);
  assert.deepEqual(snap.feeds, { kp: 'ok', xray: 'unavailable' });
  assert.throws(() => validateSpaceWeatherSnapshot({}), /Malformed/);
});

function install(fetchImpl, now = () => T) {
  let handler;
  spaceWeatherProxy({ fetchImpl, now }).configureServer({
    middlewares: { use: (_path, fn) => (handler = fn) },
  });
  return async (url) => {
    let status;
    let body = '';
    await handler(
      { method: 'GET', url },
      {
        headersSent: false,
        writeHead(code) {
          status = code;
          this.headersSent = true;
        },
        end(text) {
          body = text;
        },
      },
    );
    return { status, body: JSON.parse(body) };
  };
}
const respond = (value) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  text: async () => JSON.stringify(value),
  body: null,
});

test('provider reduces every product and survives a failed one', async () => {
  const requested = [];
  const products = {
    [SWPC_URLS.kp]: kpRows,
    [SWPC_URLS.kp1m]: [{ time_tag: '2026-10-07T02:59:00', estimated_kp: 4.33 }],
    [SWPC_URLS.plasma]: plasma,
    [SWPC_URLS.mag]: mag,
    [SWPC_URLS.xray]: xray,
    [SWPC_URLS.scales]: scales,
    [SWPC_URLS.ovation]: ovation(),
  };
  const get = install(async (url) => {
    requested.push(url);
    if (url === SWPC_URLS.alerts) throw new Error('down');
    return respond(products[url]);
  });
  const { status, body } = await get('/');
  assert.equal(status, 200);
  assert.equal(body.kp.latest.kp, 4);
  assert.equal(body.kp.estimate.kp, 4.33);
  assert.equal(body.solarWind.mag.bz, -12.5);
  assert.equal(body.xray.latest.flareClass, 'C2.3');
  assert.deepEqual(body.alerts, []);
  assert.equal(body.feeds.alerts, 'unavailable');
  assert.equal(body.stale, true, 'a missing product marks the snapshot stale');
  assert.equal(body.unavailable, false);
  const client = validateSpaceWeatherSnapshot(body);
  assert.match(spaceWeatherSummaryLines(client, T).join('\n'), /Kp 4\.00/);

  const count = requested.length;
  await get('/');
  assert.equal(requested.length, count, 'fresh products are served from cache');

  const aurora = await get('/aurora');
  assert.equal(aurora.status, 200);
  const decoded = validateAuroraSnapshot(aurora.body);
  assert.equal(decoded.unavailable, false);
  assert.equal(ovationProbabilityAt(decoded.grid, 66, 10), 55);
  assert.equal((await get('/elsewhere')).status, 404);
  for (const url of requested)
    assert.ok(Object.values(SWPC_URLS).includes(url));
});

test('provider reports unavailable with no data and no fake values', async () => {
  const get = install(async () => {
    throw new Error('offline');
  });
  const { body } = await get('/');
  assert.equal(body.unavailable, true);
  assert.equal(body.kp.latest, null);
  const aurora = validateAuroraSnapshot((await get('/aurora')).body);
  assert.equal(aurora.unavailable, true);
  assert.equal(aurora.grid, null);
});

test('space-weather layer row: chips, alert selection and honest empty state', async () => {
  const snapshot = validateSpaceWeatherSnapshot({
    schemaVersion: 1,
    fetchedAt: T,
    kp: { latest: { at: T, kp: 5.33 } },
    alerts: parseAlerts(alerts),
  });
  const layer = createSpaceWeatherLayer({
    source: { getSnapshot: async () => snapshot },
    now: () => T,
  });
  assert.match(layer.getRowControls().info, /No data yet/);
  layer.enable();
  assert.equal(await layer.update(), true);
  let row = layer.getRowControls();
  assert.equal(row.chips.length, 3);
  assert.equal(row.list.items.length, 2);
  assert.match(row.info, /G1 storm level/);
  assert.equal(layer.getStats().countLabel, 'Kp 5.3');
  layer.setParams({ alertId: row.list.items[0].params.alertId });
  row = layer.getRowControls();
  assert.ok(row.list.items[0].active);
  assert.match(row.info, /Space Weather Message Code/);
  assert.equal(layer.setParams({ alertWindow: '1y' }), false);
  assert.equal(
    alertsInWindow(snapshot.alerts, '24h', T + 2 * 86_400_000).length,
    0,
  );
  assert.equal(kpBand(5.33).label, 'Kp 5–6 G1–G2');
  layer.disable();
  assert.equal(await layer.update(), false, 'a disabled layer does not fetch');
  const failing = createSpaceWeatherLayer({
    source: {
      getSnapshot: async () => Promise.reject(new Error('SWPC HTTP 502')),
    },
  });
  failing.enable();
  await failing.update();
  assert.equal(failing.getStats().error, 'SWPC HTTP 502');
});

test('browser source validates both endpoints', async () => {
  const source = createSpaceWeatherSource({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(source.getSnapshot(), /SWPC HTTP 503/);
});
