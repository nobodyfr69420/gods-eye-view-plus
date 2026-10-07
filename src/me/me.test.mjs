import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fixFromOsmAnd,
  fixFromOwnTracks,
  fixesFromOverland,
  ingestCredential,
  normalizeFix,
  parseTimestamp,
  sanitizeDevice,
} from '../../server/providers/me/ingest.js';
import { createMeStore } from '../../server/providers/me/store.js';
import {
  createMeHandler,
  osmandParamsFromJson,
} from '../../server/providers/me.js';
import {
  parseCsvTrack,
  parseGeojson,
  parseGoogleTimeline,
  parseGpx,
  parseKml,
  parseLatLngText,
  parseLocationFile,
} from './importers.js';
import { readExifGps } from './exif.js';
import { toCsv, toGeojson, toGpx } from './exporters.js';
import {
  distanceM,
  places,
  segments,
  stays,
  thin,
  trackStats,
} from './trackMath.js';
import { accuracyCircle } from './meData.js';

const NOW = Date.UTC(2026, 9, 7, 12);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'gev-me-'));

// ── ingest ───────────────────────────────────────────────────────────────
test('fixes are validated, rounded and never invented', () => {
  assert.equal(normalizeFix({ lat: 0, lon: 0 }, NOW), null, 'null island');
  assert.equal(normalizeFix({ lat: 91, lon: 0 }, NOW), null);
  assert.equal(
    normalizeFix({ lat: 1, lon: 1, t: NOW + 3 * 86_400_000 }, NOW),
    null,
    'future',
  );
  const fix = normalizeFix(
    {
      device: 'my phone!',
      lat: 40.123456789,
      lon: -74.5,
      t: NOW / 1000,
      acc: -5,
      batt: 140,
    },
    NOW,
  );
  assert.deepEqual(fix, {
    device: 'my phone',
    t: NOW,
    lat: 40.1234568,
    lon: -74.5,
    src: 'unknown',
  });
  assert.equal(parseTimestamp('2026-10-07T12:00:00Z'), NOW);
  assert.equal(sanitizeDevice('<script>'), 'script');
});

test('OwnTracks, OsmAnd/Traccar and Overland payloads map to one fix shape', () => {
  const owntracks = fixFromOwnTracks(
    {
      _type: 'location',
      lat: 51.5,
      lon: -0.12,
      tst: NOW / 1000,
      acc: 8,
      vel: 36,
      cog: 90,
      batt: 77,
      tid: 'ab',
    },
    { now: NOW },
  );
  assert.equal(owntracks.spd, 10);
  assert.equal(owntracks.device, 'ab');
  assert.equal(fixFromOwnTracks({ _type: 'transition' }), null);

  const osmand = fixFromOsmAnd(
    new URLSearchParams({
      id: 'car',
      lat: '48.85',
      lon: '2.35',
      timestamp: String(NOW / 1000),
      speed: '10',
      bearing: '180',
    }),
    { now: NOW },
  );
  assert.equal(osmand.device, 'car');
  assert.equal(osmand.spd, 5.14);
  const gpslogger = fixFromOsmAnd(
    { lat: '1', lon: '2', spd_ms: '3', timestamp: '2026-10-07T12:00:00Z' },
    { now: NOW },
  );
  assert.equal(gpslogger.spd, 3);
  assert.equal(
    fixFromOsmAnd({ location: '10.5,20.25', timestamp: NOW }, { now: NOW }).lon,
    20.25,
  );

  const overland = fixesFromOverland(
    {
      locations: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
          properties: {
            timestamp: '2026-10-07T11:59:00Z',
            speed: -1,
            battery_level: 0.5,
            device_id: 'iphone',
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {},
        },
      ],
    },
    { now: NOW },
  );
  assert.equal(overland.length, 1);
  assert.equal(overland[0].batt, 50);
  assert.equal(overland[0].spd, undefined, 'negative speed means unknown');

  const params = osmandParamsFromJson({
    device_id: 'p',
    location: {
      timestamp: '2026-10-07T12:00:00Z',
      coords: { latitude: 1, longitude: 2, speed: 4, heading: -1 },
      battery: { level: 0.3 },
    },
  });
  assert.equal(params.spd_ms, 4);
  assert.equal(params.bearing, null);
});

test('ingest credentials come from Basic auth, Bearer, header or query', () => {
  const basic = `Basic ${btoa('phone:s3cret')}`;
  assert.deepEqual(ingestCredential({ authorization: basic }), {
    token: 's3cret',
    user: 'phone',
  });
  assert.equal(ingestCredential({ authorization: 'Bearer abc' }).token, 'abc');
  assert.equal(ingestCredential({ 'x-me-token': 'h' }).token, 'h');
  assert.equal(ingestCredential({}, new URLSearchParams('token=q')).token, 'q');
});

// ── store ────────────────────────────────────────────────────────────────
test('the store dedupes, sorts, persists and forgets', () => {
  const dir = tmp();
  try {
    const store = createMeStore({ dir, env: {} });
    const a = { device: 'p', t: 2000, lat: 1, lon: 1, src: 'x' };
    const b = { device: 'p', t: 1000, lat: 2, lon: 2, src: 'x' };
    assert.equal(store.add([a, b, a]), 2);
    assert.deepEqual(
      store.track().map((f) => f.t),
      [1000, 2000],
    );
    const reopened = createMeStore({ dir, env: {} });
    assert.equal(reopened.devices()[0].count, 2);
    assert.equal(reopened.forget('p'), 2);
    assert.equal(createMeStore({ dir, env: {} }).track().length, 0);
    const token = reopened.token();
    assert.ok(token.length >= 16);
    assert.equal(
      createMeStore({ dir, env: {} }).token(),
      token,
      'token is stable',
    );
    assert.equal(
      createMeStore({
        dir,
        env: { ME_INGEST_TOKEN: 'from-env-token-123' },
      }).token(),
      'from-env-token-123',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── handler ──────────────────────────────────────────────────────────────
function call(
  handler,
  { method = 'GET', url, headers = {}, body = '', remote = '127.0.0.1' },
) {
  return new Promise((resolve) => {
    const chunks =
      typeof body === 'string'
        ? [Buffer.from(body)]
        : [Buffer.from(JSON.stringify(body))];
    const req = {
      method,
      url,
      headers: { host: 'localhost:4173', ...headers },
      socket: { remoteAddress: remote, localPort: 4173 },
      on(event, fn) {
        if (event === 'data')
          queueMicrotask(() => chunks.forEach((c) => fn(c)));
        if (event === 'end') queueMicrotask(() => queueMicrotask(fn));
        return req;
      },
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      writableEnded: false,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      writeHead(status, headers) {
        this.statusCode = status;
        Object.assign(this.headers, headers);
      },
      end(text) {
        this.writableEnded = true;
        let parsed = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* plain text */
        }
        resolve({ status: this.statusCode, body: parsed });
      },
    };
    handler(req, res);
  });
}

test('ingest requires the token; local views refuse LAN peers without it', async () => {
  const dir = tmp();
  try {
    const store = createMeStore({
      dir,
      env: { ME_INGEST_TOKEN: 'tok-1234567890abcdef' },
    });
    const handler = createMeHandler({ store, env: {} });
    const denied = await call(handler, {
      url: '/osmand?lat=1&lon=2',
      remote: '192.168.1.5',
    });
    assert.equal(denied.status, 401);
    const ok = await call(handler, {
      url: '/osmand?token=tok-1234567890abcdef&id=phone&lat=1&lon=2',
      remote: '192.168.1.5',
    });
    assert.equal(ok.status, 200);
    const owntracks = await call(handler, {
      method: 'POST',
      url: '/owntracks',
      remote: '192.168.1.5',
      headers: {
        authorization: `Basic ${btoa('pixel:tok-1234567890abcdef')}`,
        'content-type': 'application/json',
      },
      body: {
        _type: 'location',
        lat: 3,
        lon: 4,
        tst: Math.floor(Date.now() / 1000) - 5,
      },
    });
    assert.deepEqual(owntracks.body, []);
    const crossSite = await call(handler, {
      url: '/osmand?token=tok-1234567890abcdef&lat=1&lon=2',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);

    const lanState = await call(handler, {
      url: '/state',
      remote: '192.168.1.5',
    });
    assert.equal(lanState.status, 403);
    const local = await call(handler, { url: '/state' });
    assert.deepEqual(local.body.devices.map((d) => d.device).sort(), [
      'phone',
      'pixel',
    ]);
    const withToken = await call(handler, {
      url: '/track?token=tok-1234567890abcdef',
      remote: '192.168.1.5',
    });
    assert.equal(withToken.body.fixes.length, 2);
    const proxied = await call(handler, {
      url: '/setup',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    assert.equal(proxied.status, 403);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup reports LAN reachability and the IP lookup is cached and validated', async () => {
  const dir = tmp();
  try {
    let calls = 0;
    const handler = createMeHandler({
      store: createMeStore({ dir, env: {} }),
      env: {},
      getServerHost: () => 'localhost',
      interfaces: () => ({
        Wi: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
      }),
      fetchImpl: async () => {
        calls++;
        return {
          ok: true,
          json: async () => ({
            success: true,
            ip: '1.2.3.4',
            city: 'Austin',
            country: 'United States',
            latitude: 30.2,
            longitude: -97.7,
          }),
        };
      },
    });
    const setup = await call(handler, { url: '/setup' });
    assert.equal(setup.body.reachableOnLan, false);
    assert.equal(setup.body.lan[0].base, 'http://192.168.1.20:4173/api/me');
    const ip = await call(handler, { url: '/ip' });
    assert.equal(ip.body.city, 'Austin');
    await call(handler, { url: '/ip' });
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── importers ────────────────────────────────────────────────────────────
test('GPX, KML, GeoJSON and CSV imports read positions and times', () => {
  const gpx = `<gpx><trk><trkseg><trkpt lat="45.1" lon="7.2"><ele>300</ele><time>2026-01-01T10:00:00Z</time></trkpt><trkpt lat="45.2" lon="7.3"/></trkseg></trk><wpt lat="1" lon="2"></wpt></gpx>`;
  const g = parseGpx(gpx);
  assert.equal(g.length, 3);
  assert.equal(g[0].alt, 300);
  assert.equal(g[0].t, Date.UTC(2026, 0, 1, 10));

  const kml = `<kml><Placemark><LineString><coordinates>7.2,45.1,0 7.3,45.2,0</coordinates></LineString></Placemark></kml>`;
  assert.equal(parseKml(kml).length, 2);
  const gx = `<kml><gx:Track><when>2026-01-01T10:00:00Z</when><gx:coord>7.2 45.1 300</gx:coord></gx:Track></kml>`;
  assert.equal(parseKml(gx)[0].alt, 300);

  const geo = parseGeojson({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          coordTimes: ['2026-01-01T10:00:00Z', '2026-01-01T10:01:00Z'],
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [7.2, 45.1],
            [7.3, 45.2],
          ],
        },
      },
    ],
  });
  assert.equal(geo[1].t, Date.UTC(2026, 0, 1, 10, 1));

  const csv = parseCsvTrack(
    'Latitude,Longitude,Time,Accuracy\n45.1,7.2,2026-01-01T10:00:00Z,12\nx,y,z,w',
  );
  assert.deepEqual(csv, [
    { lat: 45.1, lon: 7.2, t: Date.UTC(2026, 0, 1, 10), acc: 12 },
  ]);
});

test('every Google Timeline export shape is understood', () => {
  const records = parseGoogleTimeline({
    locations: [
      {
        latitudeE7: 451000000,
        longitudeE7: 72000000,
        timestamp: '2020-01-01T00:00:00Z',
        accuracy: 20,
      },
    ],
  });
  assert.deepEqual(records[0], {
    lat: 45.1,
    lon: 7.2,
    t: Date.UTC(2020, 0, 1),
    acc: 20,
  });
  const semantic = parseGoogleTimeline({
    timelineObjects: [
      {
        placeVisit: {
          location: {
            latitudeE7: 451000000,
            longitudeE7: 72000000,
            name: 'Home',
          },
          duration: {
            startTimestamp: '2020-01-01T00:00:00Z',
            endTimestamp: '2020-01-01T08:00:00Z',
          },
        },
      },
      {
        activitySegment: {
          startLocation: { latitudeE7: 451000000, longitudeE7: 72000000 },
          endLocation: { latitudeE7: 452000000, longitudeE7: 73000000 },
          duration: {
            startTimestamp: '2020-01-01T08:00:00Z',
            endTimestamp: '2020-01-01T08:30:00Z',
          },
          simplifiedRawPath: {
            points: [
              {
                latE7: 451500000,
                lngE7: 72500000,
                timestamp: '2020-01-01T08:15:00Z',
              },
            ],
          },
        },
      },
    ],
  });
  assert.equal(semantic.length, 5);
  assert.equal(semantic[0].place, 'Home');
  const device = parseGoogleTimeline({
    semanticSegments: [
      {
        startTime: '2026-01-01T10:00:00.000+01:00',
        endTime: '2026-01-01T11:00:00.000+01:00',
        timelinePath: [
          {
            point: '45.1000000°, 7.2000000°',
            time: '2026-01-01T10:05:00.000+01:00',
          },
        ],
      },
    ],
    rawSignals: [
      {
        position: {
          LatLng: '45.2°, 7.3°',
          accuracyMeters: 9,
          timestamp: '2026-01-01T10:10:00.000+01:00',
        },
      },
    ],
  });
  assert.equal(device.length, 2);
  assert.equal(device[1].acc, 9);
  const ios = parseGoogleTimeline([
    {
      startTime: '2026-01-01T10:00:00Z',
      endTime: '2026-01-01T11:00:00Z',
      timelinePath: [
        { point: 'geo:45.1,7.2', durationMinutesOffsetFromStartTime: '30' },
      ],
    },
  ]);
  assert.equal(ios[0].t, Date.UTC(2026, 0, 1, 10, 30));
  assert.deepEqual(parseLatLngText('geo:-33.86,151.2'), [-33.86, 151.2]);
});

test('file sniffing picks the right parser', () => {
  assert.equal(
    parseLocationFile(
      'a.json',
      JSON.stringify({ type: 'FeatureCollection', features: [] }),
    ).format,
    'geojson',
  );
  assert.equal(
    parseLocationFile('Timeline.json', JSON.stringify({ semanticSegments: [] }))
      .format,
    'google-timeline',
  );
  assert.equal(
    parseLocationFile('route', '<?xml version="1.0"?><gpx></gpx>').format,
    'gpx',
  );
});

/** Build a tiny JPEG whose EXIF carries a GPS IFD. */
function jpegWithGps({ lat, lon, latRef, lonRef }) {
  const le = true;
  const tiff = new DataView(new ArrayBuffer(200));
  tiff.setUint16(0, 0x4949);
  tiff.setUint16(2, 42, le);
  tiff.setUint32(4, 8, le);
  // IFD0: one entry → GPS pointer
  tiff.setUint16(8, 1, le);
  tiff.setUint16(10, 0x8825, le);
  tiff.setUint16(12, 4, le);
  tiff.setUint32(14, 1, le);
  tiff.setUint32(18, 26, le);
  tiff.setUint32(22, 0, le);
  // GPS IFD at 26: 4 entries
  const entries = [
    [1, 2, 2, latRef.charCodeAt(0)],
    [2, 5, 3, 100],
    [3, 2, 2, lonRef.charCodeAt(0)],
    [4, 5, 3, 124],
  ];
  tiff.setUint16(26, entries.length, le);
  entries.forEach(([tag, type, n, value], i) => {
    const at = 28 + i * 12;
    tiff.setUint16(at, tag, le);
    tiff.setUint16(at + 2, type, le);
    tiff.setUint32(at + 4, n, le);
    if (type === 2) tiff.setUint8(at + 8, value);
    else tiff.setUint32(at + 8, value, le);
  });
  const rational = (offset, [d, m, s]) => {
    [
      [d, 1],
      [m, 1],
      [Math.round(s * 100), 100],
    ].forEach(([num, den], i) => {
      tiff.setUint32(offset + i * 8, num, le);
      tiff.setUint32(offset + i * 8 + 4, den, le);
    });
  };
  rational(100, lat);
  rational(124, lon);
  const app1Length = 2 + 6 + 200;
  const out = new Uint8Array(4 + app1Length + 2);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe1);
  view.setUint16(4, app1Length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  out.set(new Uint8Array(tiff.buffer), 12);
  view.setUint16(out.length - 2, 0xffd9);
  return out.buffer;
}

test('photo EXIF GPS is read with hemisphere signs', () => {
  const gps = readExifGps(
    jpegWithGps({
      lat: [40, 41, 21.12],
      lon: [74, 2, 40.2],
      latRef: 'N',
      lonRef: 'W',
    }),
  );
  assert.ok(Math.abs(gps.lat - 40.6892) < 1e-4);
  assert.ok(Math.abs(gps.lon + 74.0445) < 1e-4);
  assert.equal(readExifGps(new Uint8Array([1, 2, 3]).buffer), null);
  assert.equal(
    parseLocationFile(
      'IMG_1.jpg',
      jpegWithGps({ lat: [1, 0, 0], lon: [2, 0, 0], latRef: 'S', lonRef: 'E' }),
    ).fixes[0].lat,
    -1,
  );
});

// ── maths & exports ──────────────────────────────────────────────────────
const walk = (n, { start = NOW, stepMs = 10_000, dLat = 0.0001 } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    device: 'p',
    t: start + i * stepMs,
    lat: 40 + i * dLat,
    lon: -74,
    acc: 5,
  }));

test('track stats ignore standing-still jitter and teleports', () => {
  const moving = trackStats(walk(61)); // 60 × ~11 m in 10 s
  assert.ok(Math.abs(moving.distanceM - 667) < 5, String(moving.distanceM));
  assert.equal(Math.round(moving.movingMs / 1000), 600);
  const still = trackStats(walk(60, { dLat: 0.000001 }));
  assert.equal(still.distanceM, 0);
  const jump = trackStats([
    ...walk(2),
    { device: 'p', t: NOW + 20_000, lat: 10, lon: 10 },
  ]);
  assert.ok(jump.distanceM < 50);
  assert.ok(
    Math.abs(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111_195) < 10,
  );
});

test('segments split on gaps; stays and places find where time was spent', () => {
  const a = walk(5);
  const b = walk(5, { start: NOW + 3_600_000 });
  assert.equal(segments([...a, ...b]).length, 2);
  const home = Array.from({ length: 30 }, (_, i) => ({
    device: 'p',
    t: NOW + i * 60_000,
    lat: 40 + (i % 2) * 0.0001,
    lon: -74,
  }));
  const found = stays(home);
  assert.equal(found.length, 1);
  assert.equal(Math.round(found[0].dwellMs / 60_000), 29);
  assert.equal(places([...found, ...found])[0].visits, 2);
  assert.ok(thin(walk(1000), 50).length < 1000);
});

test('exports round-trip through the importers', () => {
  const fixes = walk(3);
  assert.equal(parseGpx(toGpx(fixes)).length, 3);
  assert.equal(parseGeojson(JSON.parse(toGeojson(fixes))).length, 3);
  assert.equal(parseCsvTrack(toCsv(fixes)).length, 3);
});

test('accuracy circles are closed rings of the right radius', () => {
  const ring = accuracyCircle(40, -74, 1000).coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.ok(
    Math.abs(
      distanceM({ lat: 40, lon: -74 }, { lat: ring[12][1], lon: ring[12][0] }) -
        1000,
    ) < 5,
  );
});

test('phone setup prefers the real Wi-Fi/Ethernet address over VM bridges', async () => {
  const { lanAddresses } = await import('../../server/providers/me.js');
  const list = lanAddresses({
    'vEthernet (WSL)': [
      { family: 'IPv4', address: '172.23.0.1', internal: false },
    ],
    'Wi-Fi 6': [{ family: 'IPv4', address: '192.168.1.25', internal: false }],
    Tailscale: [{ family: 'IPv4', address: '100.101.1.2', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  });
  assert.deepEqual(
    list.map((a) => a.address),
    ['192.168.1.25', '100.101.1.2', '172.23.0.1'],
  );
});
