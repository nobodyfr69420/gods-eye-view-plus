import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AURORA_BANDS,
  auroraBandIndex,
  auroraRuns,
  auroraHemisphereStats,
} from './model.js';
import { OVATION_CELLS, OVATION_COLUMNS } from '../spaceWeather/records.js';
import { createAuroraLayer } from './index.js';

function grid(cells) {
  const g = new Uint8Array(OVATION_CELLS);
  for (const [lon, lat, p] of cells)
    g[(lat + 90) * OVATION_COLUMNS + ((lon + 360) % 360)] = p;
  return g;
}

test('bands are ordered and thresholds pick a band', () => {
  assert.deepEqual(
    AURORA_BANDS.map((b) => b.min),
    [10, 30, 50, 80],
  );
  assert.equal(auroraBandIndex(9), -1);
  assert.equal(auroraBandIndex(10), 0);
  assert.equal(auroraBandIndex(49), 1);
  assert.equal(auroraBandIndex(100), 3);
});

test('runs merge same-band cells in a row and never cross the seam', () => {
  const g = grid([
    [178, 65, 40],
    [179, 65, 40],
    [-180, 65, 40],
    [-179, 65, 90],
    [10, -70, 5],
  ]);
  const runs = auroraRuns(g, 10);
  assert.deepEqual(runs, [
    { west: -180, east: -179.5, south: 64.5, north: 65.5, band: 1 },
    { west: -179.5, east: -178.5, south: 64.5, north: 65.5, band: 3 },
    { west: 177.5, east: 179.5, south: 64.5, north: 65.5, band: 1 },
  ]);
  assert.equal(auroraRuns(g, 50).length, 1);
  assert.deepEqual(auroraRuns(new Uint8Array(3)), []);
});

test('hemisphere stats report the equatorward edge and peak', () => {
  const g = grid([
    [0, 70, 80],
    [0, 55, 12],
    [0, -62, 30],
  ]);
  const s = auroraHemisphereStats(g, 10);
  assert.deepEqual(s.north, { maxProbability: 80, equatorwardLat: 55 });
  assert.deepEqual(s.south, { maxProbability: 30, equatorwardLat: -62 });
});

test('aurora layer: no fake oval when the forecast is unavailable', async () => {
  const layer = createAuroraLayer({
    source: {
      getAurora: async () => ({
        unavailable: true,
        reason: 'OVATION aurora forecast unavailable',
      }),
    },
  });
  layer.init(null);
  layer.enable();
  await layer.update();
  assert.equal(layer.getStats().count, 0);
  assert.equal(layer.getStats().status, 'unavailable');
  assert.match(layer.getRowControls().info, /unavailable/);
  assert.equal(layer.setParams({ threshold: 30 }), true);
  assert.equal(
    layer.getRowControls().chips.find((c) => c.active).label,
    '≥30%',
  );
  assert.equal(layer.setParams({ threshold: 7 }), false);
  layer.destroy();
});
