import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_SETUP_KEYS } from './keySetupCore.mjs';
import {
  GENERATED_SECRETS,
  KEY_PROBES,
  KEY_SHAPES,
  classifyCandidate,
  cleanCandidate,
  decodeJwtClaims,
  isWritableValue,
  maskKey,
  matchesShape,
  planImport,
  probeKey,
  wizardEntries,
  wizardEnvVars,
} from './keyWizardCore.mjs';

const GOOGLE = 'AIza' + 'B'.repeat(35);
const OPENAI = 'sk-proj-' + 'a1'.repeat(20);
const HEX32 = '0123456789abcdef'.repeat(2);
const jwt = (claims) =>
  [{ alg: 'HS256', typ: 'JWT' }, claims]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .join('.') + '.sig';

test('every registry env var has a shape and every registry entry a probe', () => {
  for (const entry of KEY_SETUP_KEYS) {
    for (const name of entry.envVars)
      assert.ok(KEY_SHAPES[name], `${name} has a shape`);
    if (entry.id !== 'google-maps-server')
      assert.equal(
        typeof KEY_PROBES[entry.id],
        'function',
        `${entry.id} probe`,
      );
  }
});

test('masking never reveals more than four characters', () => {
  assert.equal(maskKey(GOOGLE), '…BBBB');
  assert.equal(maskKey('abc'), '…•••');
  assert.equal(maskKey(''), '');
});

test('clipboard candidates are cleaned of assignments, quotes and newlines', () => {
  assert.equal(cleanCandidate(`  ${GOOGLE}\r\n`), GOOGLE);
  assert.equal(cleanCandidate(`GOOGLE_MAPS_API_KEY=${GOOGLE}`), GOOGLE);
  assert.equal(cleanCandidate(`export X="${HEX32}"`), HEX32);
  assert.equal(cleanCandidate('two words'), null);
  assert.equal(cleanCandidate('x'.repeat(600)), null);
  assert.equal(cleanCandidate('ключ'), null);
});

test('distinctive keys are filed to their provider wherever they appear', () => {
  const missing = new Set([
    'GOOGLE_MAPS_API_KEY',
    'OPENAI_API_KEY',
    'FIRMS_MAP_KEY',
  ]);
  assert.deepEqual(
    classifyCandidate(GOOGLE, { expected: 'FIRMS_MAP_KEY', missing }),
    {
      envVar: 'GOOGLE_MAPS_API_KEY',
      value: GOOGLE,
      reason: 'distinctive',
    },
  );
  assert.equal(
    classifyCandidate(OPENAI, { expected: null, missing }).envVar,
    'OPENAI_API_KEY',
  );
});

test('an ambiguous key is only accepted for the provider being asked for', () => {
  const missing = new Set([
    'FIRMS_MAP_KEY',
    'OWM_API_KEY',
    'THUNDERFOREST_API_KEY',
  ]);
  assert.equal(classifyCandidate(HEX32, { expected: null, missing }), null);
  assert.equal(
    classifyCandidate(HEX32, { expected: 'OWM_API_KEY', missing }).envVar,
    'OWM_API_KEY',
  );
  // A URL or prose on the clipboard is never taken for a key.
  assert.equal(
    classifyCandidate('https://example.com/a', {
      expected: 'OPENAIP_API_KEY',
      missing,
    }),
    null,
  );
});

test('an already-set provider is not re-filed from the clipboard', () => {
  assert.equal(
    classifyCandidate(GOOGLE, {
      expected: null,
      missing: new Set(['OPENAI_API_KEY']),
    }),
    null,
  );
});

test('Cesium ion tokens are recognized by their claims, not just the JWT shape', () => {
  const ion = jwt({ jti: 'abc', id: 42, iat: 1 });
  assert.equal(decodeJwtClaims(ion).id, 42);
  assert.ok(matchesShape('CESIUM_ION_TOKEN', ion));
  assert.ok(!matchesShape('CESIUM_ION_TOKEN', jwt({ sub: 'someone' })));
});

test('import plans take the first writable value for each missing var only', () => {
  const plan = planImport({ GOOGLE_MAPS_API_KEY: GOOGLE }, [
    {
      label: 'a',
      env: { GOOGLE_MAPS_API_KEY: 'AIzaOTHER', FIRMS_MAP_KEY: 'bad#value' },
    },
    { label: 'b', env: { FIRMS_MAP_KEY: HEX32, UNRELATED: 'x' } },
  ]);
  assert.deepEqual(plan, [
    { envVar: 'FIRMS_MAP_KEY', value: HEX32, from: 'b' },
  ]);
});

test('writable values follow the Provider Settings character rules', () => {
  assert.ok(isWritableValue(HEX32));
  for (const bad of ['', 'a b', 'a#b', 'a$b', 'a"b', "a'b", 'a\\b', 'a`b'])
    assert.ok(!isWritableValue(bad), JSON.stringify(bad));
});

test('wizard entries report per-variable presence and generated secrets are managed', () => {
  const opensky = wizardEntries({ OPENSKY_CLIENT_ID: 'me-api-client' }).find(
    (e) => e.id === 'opensky',
  );
  assert.equal(opensky.set, false);
  assert.deepEqual(
    opensky.vars.map((v) => v.set),
    [true, false],
  );
  for (const secret of GENERATED_SECRETS)
    assert.ok(wizardEnvVars().has(secret.envVar));
});

const fakeFetch = (status, body = '', contentType = 'application/json') => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      headers: { get: () => contentType },
      text: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
};

test('probes only contact the issuing provider and map statuses to verdicts', async () => {
  const ok = fakeFetch(200, '{"status":"ok"}');
  const waqi = await probeKey('waqi', { WAQI_TOKEN: 'k' }, { fetchImpl: ok });
  assert.equal(waqi.result, 'valid');
  assert.match(ok.calls[0].url, /^https:\/\/api\.waqi\.info\//);

  const rejected = await probeKey(
    'thunderforest',
    { THUNDERFOREST_API_KEY: 'k' },
    { fetchImpl: fakeFetch(401) },
  );
  assert.equal(rejected.result, 'invalid');

  const restricted = await probeKey(
    'google-maps',
    { GOOGLE_MAPS_API_KEY: GOOGLE },
    {
      fetchImpl: fakeFetch(403, 'Requests from referer <empty> are blocked.'),
    },
  );
  assert.equal(restricted.result, 'unverified');

  const disabled = await probeKey(
    'google-maps',
    { GOOGLE_MAPS_API_KEY: GOOGLE },
    { fetchImpl: fakeFetch(404, '{"error":{"code":404}}') },
  );
  assert.equal(disabled.result, 'invalid');
  assert.match(disabled.note, /Map Tiles API/);
});

test('a probe that cannot reach its provider is unverified, never invalid', async () => {
  const result = await probeKey(
    'openai',
    { OPENAI_API_KEY: OPENAI },
    {
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    },
  );
  assert.deepEqual(result, {
    id: 'openai',
    result: 'unverified',
    note: 'network error',
  });
});

test('credentials are sent as headers or form bodies, never echoed in results', async () => {
  const fetchImpl = fakeFetch(200);
  const result = await probeKey(
    'opensky',
    {
      OPENSKY_CLIENT_ID: 'me-api-client',
      OPENSKY_CLIENT_SECRET: 'S'.repeat(32),
    },
    { fetchImpl },
  );
  assert.equal(result.result, 'valid');
  assert.equal(fetchImpl.calls[0].init.method, 'POST');
  assert.ok(!JSON.stringify(result).includes('S'.repeat(32)));
});

test('the AISStream probe reads the first stream message', async () => {
  class FakeSocket {
    constructor() {
      this.listeners = {};
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
    emit(type, event = {}) {
      this.listeners[type]?.(event);
    }
    send() {
      queueMicrotask(() =>
        this.emit('message', { data: '{"error":"Api Key Is Not Valid"}' }),
      );
    }
    close() {}
  }
  const result = await probeKey(
    'aisstream',
    { AISSTREAM_API_KEY: HEX32 },
    { WebSocketImpl: FakeSocket, timeoutMs: 1000 },
  );
  assert.equal(result.result, 'invalid');
});
