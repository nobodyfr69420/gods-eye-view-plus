import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nodeSupported } from '../../scripts/launch.mjs';

const root = new URL('../../', import.meta.url);

test('the launcher accepts exactly the Node versions package.json allows', () => {
  const engines = JSON.parse(
    readFileSync(new URL('package.json', root), 'utf8'),
  ).engines.node;
  assert.equal(engines, '>=24.14.0 <25 || >=26 <27');
  for (const ok of ['24.14.0', '24.21.0', '26.0.0', '26.3.1'])
    assert.ok(nodeSupported(ok), ok);
  for (const bad of ['22.12.0', '24.13.9', '25.1.0', '27.0.0'])
    assert.ok(!nodeSupported(bad), bad);
});

test('the one-click files start the same launcher with the right line endings', () => {
  const cmd = readFileSync(new URL('Start-GodsEyeView.cmd', root), 'utf8');
  assert.match(cmd, /\r\n/, 'cmd.exe scripts keep CRLF');
  assert.match(cmd, /cd \/d "%~dp0"/);
  assert.match(cmd, /node scripts\\launch\.mjs %\*/);
  const sh = readFileSync(new URL('Start-GodsEyeView.command', root), 'utf8');
  assert.doesNotMatch(sh, /\r/, 'shell launcher stays LF');
  assert.match(sh, /exec node scripts\/launch\.mjs "\$@"/);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts.start, 'node scripts/launch.mjs');
});

test('the desktop icon ships as a multi-size PNG-in-ICO', () => {
  const ico = readFileSync(new URL('launcher/gods-eye-view.ico', root));
  assert.equal(ico.readUInt16LE(2), 1, 'icon type');
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 4);
  const sizes = Array.from(
    { length: count },
    (_, i) => ico.readUInt8(6 + i * 16) || 256,
  );
  assert.ok(sizes.includes(16) && sizes.includes(32) && sizes.includes(256));
  const firstOffset = ico.readUInt32LE(6 + 12);
  assert.equal(
    ico.subarray(firstOffset + 1, firstOffset + 4).toString('latin1'),
    'PNG',
  );
});
