import test from 'node:test';
import assert from 'node:assert/strict';
import { createSatelliteGroupsLayer } from './index.js';
import { createReentriesLayer } from '../reentries/index.js';
import { createCrewedStationsLayer } from '../crewedStations/index.js';
import { ISS_L1, ISS_L2 } from '../../testSupport/spaceTle.mjs';
import { tleEpochMs } from './model.js';

const EPOCH = tleEpochMs(ISS_L1);
// Cesium's Material checks image-like uniforms by DOM class; Node has none.
for (const name of [
  'HTMLCanvasElement',
  'HTMLImageElement',
  'HTMLVideoElement',
  'ImageBitmap',
  'OffscreenCanvas',
])
  globalThis[name] ??= class {};

function fakeViewer() {
  const primitives = new Set();
  const listeners = new Set();
  return {
    primitives,
    listeners,
    scene: {
      canvas: null,
      primitives: {
        add: (p) => (primitives.add(p), p),
        remove: (p) => primitives.delete(p),
      },
      preRender: {
        addEventListener: (fn) => (
          listeners.add(fn),
          () => listeners.delete(fn)
        ),
      },
      pick: () => undefined,
    },
    camera: {
      positionCartographic: {
        latitude: (40 * Math.PI) / 180,
        longitude: (-100 * Math.PI) / 180,
        height: 1e7,
      },
      flyTo() {},
    },
  };
}
function fakeOverlay() {
  const sources = new Map();
  return {
    sources,
    setEntries: (id, entries) => sources.set(id, entries),
    setVisible() {},
    clearSource: (id) => sources.delete(id),
  };
}
const groupText = (norad, name) =>
  [
    name,
    ISS_L1.replace('25544U', `${norad}U`),
    ISS_L2.replace('25544 ', `${norad} `),
  ].join('\n');

test('satellite groups load lazily, select, and leave nothing behind on disable', async () => {
  const reads = [];
  const contexts = [];
  const source = {
    async readGroup(group) {
      reads.push(group);
      if (group === 'weather')
        return {
          ok: false,
          status: 502,
          text: '',
          stale: false,
          fetchedAt: null,
        };
      return {
        ok: true,
        status: 200,
        text: groupText(group === 'gnss' ? 11111 : 22222, `SAT ${group}`),
        stale: false,
        fetchedAt: EPOCH,
      };
    },
  };
  const overlay = fakeOverlay();
  const viewer = fakeViewer();
  const layer = createSatelliteGroupsLayer({
    source,
    overlayHost: overlay,
    now: () => EPOCH,
    context: {
      registerEntityContext: (_e, meta) => contexts.push(meta),
      selectEntityContext() {},
      clearSelectedEntityContextForLayer: () => contexts.push('cleared'),
      removeEntityContextsForLayer() {},
    },
  });
  layer.init(viewer);
  assert.equal(await layer.update(), false, 'no fetch while disabled');
  assert.equal(reads.length, 0);
  layer.enable();
  assert.equal(viewer.listeners.size, 1);
  assert.equal(await layer.update(), true);
  assert.ok(
    !reads.includes('starlink'),
    'heavy shells stay unloaded by default',
  );
  assert.equal(
    layer.getStats().count,
    2,
    'one GNSS object plus one shared fixture object',
  );
  assert.match(layer.getStats().error, /Partial: weather unavailable/);
  const row = layer.getRowControls();
  assert.ok(row.chips.find((c) => c.id === 'category:gnss').active);
  assert.equal(
    row.chips.find((c) => c.id === 'category:weather').state,
    'error',
  );

  layer.setParams({ noradId: 11111 });
  assert.equal(layer.getParams().noradId, 11111);
  assert.equal(contexts[0].layerId, 'satellite-groups');
  assert.equal(overlay.sources.get('satellite-groups').length, 1);
  assert.match(layer.getRowControls().info, /NORAD 11111/);
  assert.match(
    layer.getRowControls().info,
    /Passes ≥10° over camera nadir 40\.0°, -100\.0°/,
  );
  for (const fn of viewer.listeners) fn();

  const before = reads.length;
  layer.setParams({ toggleCategory: 'starlink' });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(reads.slice(before).includes('starlink'));

  layer.disable();
  assert.equal(viewer.listeners.size, 0);
  assert.equal(overlay.sources.size, 0);
  assert.ok(contexts.includes('cleared'));
  layer.destroy();
  assert.equal(viewer.primitives.size, 0, 'all primitives removed on destroy');
});

test('re-entries and crewed stations render from their sources and clean up', async () => {
  const lowText = [
    'LOW 1',
    ISS_L1.replace('25544U', '33333U'),
    ISS_L2.replace('25544 ', '33333 ').replace('15.72125391', '16.40000000'),
  ].join('\n');
  const tleSource = {
    async readGroup(group) {
      const text =
        group === 'stations' ? groupText(25544, 'ISS (ZARYA)') : lowText;
      return { ok: true, status: 200, text, stale: false, fetchedAt: EPOCH };
    },
  };
  const viewer = fakeViewer();
  const overlay = fakeOverlay();
  const reentries = createReentriesLayer({
    source: {
      getSnapshot: async () => ({
        configured: false,
        unavailable: true,
        tips: [],
      }),
    },
    tleSource,
    overlayHost: overlay,
    now: () => EPOCH + 3_600_000,
  });
  reentries.init(viewer);
  reentries.enable();
  assert.equal(await reentries.update(), true);
  let row = reentries.getRowControls();
  assert.equal(row.chips.find((c) => c.id === 'tip').disabled, true);
  assert.match(row.info, /SPACETRACK_IDENTITY/);
  assert.equal(row.list.items[0].lead, 'EST');
  reentries.setParams({ kind: 'watch', norad: 33333 });
  row = reentries.getRowControls();
  assert.match(row.info, /ESTIMATED/);
  reentries.destroy();
  assert.equal(viewer.primitives.size, 0);

  const crewViewer = fakeViewer();
  const stations = createCrewedStationsLayer({
    tleSource,
    crewSource: {
      getSnapshot: async () => ({
        unavailable: false,
        source: 'Open Notify (community)',
        fetchedAt: EPOCH,
        people: [{ name: 'A', craft: 'ISS' }],
        counts: { ISS: 1, 'Crew Dragon Free Flyer': 2 },
      }),
    },
    overlayHost: overlay,
    now: () => EPOCH,
  });
  stations.init(crewViewer);
  stations.enable();
  await stations.update();
  assert.equal(stations.getStats().countLabel, '1 crew');
  const info = stations.getRowControls().info;
  assert.match(info, /International Space Station · NORAD 25544 · 1 aboard/);
  assert.match(info, /Also in space: Crew Dragon Free Flyer 2/);
  assert.match(info, /community-maintained/);
  assert.equal(overlay.sources.get('crewed-stations')[0].title, 'ISS · 1 crew');
  stations.disable();
  assert.equal(crewViewer.listeners.size, 0);
  stations.destroy();
  assert.equal(crewViewer.primitives.size, 0);
});
