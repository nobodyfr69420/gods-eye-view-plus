import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAY_DEFINITIONS, OVERLAY_BY_ID } from './definitions.js';
import { OVERLAY_CATEGORIES } from './categories.js';
import {
  getOverlayFeed,
  overlayFeedIds,
} from '../../server/providers/overlayFeeds/feeds.js';
import { OVERLAY_TILE_SOURCES } from '../../server/providers/overlayTiles.js';

const KINDS = new Set(['imagery', 'feed', 'osm', 'computed', 'local']);
const COMPUTED = new Set([
  'graticule',
  'graticule-local',
  'parallels',
  'meridians',
  'utm',
  'maidenhead',
  'time-meridians',
  'range-rings',
  'horizon',
  'antipode',
  'compass-lines',
  'twilight',
  'subsolar',
  'sublunar',
  'night',
  'golden-hour',
]);
const OSM_LAYERS = new Set([
  'aerodrome_label',
  'aeroway',
  'boundary',
  'building',
  'landuse',
  'mountain_peak',
  'park',
  'place',
  'poi',
  'transportation',
  'waterway',
]);

test('the library ships well over 100 overlays across every category', () => {
  assert.ok(
    OVERLAY_DEFINITIONS.length >= 250,
    `only ${OVERLAY_DEFINITIONS.length}`,
  );
  const used = new Set(OVERLAY_DEFINITIONS.map((d) => d.category));
  for (const category of OVERLAY_CATEGORIES)
    assert.ok(used.has(category.id), `empty category ${category.id}`);
});

test('overlay ids are unique, stable slugs with complete metadata', () => {
  assert.equal(OVERLAY_BY_ID.size, OVERLAY_DEFINITIONS.length);
  const categoryIds = new Set(OVERLAY_CATEGORIES.map((c) => c.id));
  for (const def of OVERLAY_DEFINITIONS) {
    assert.match(def.id, /^[a-z0-9][a-z0-9-]*$/, def.id);
    assert.ok(KINDS.has(def.kind), `${def.id} kind`);
    assert.ok(categoryIds.has(def.category), `${def.id} category`);
    assert.ok(def.name && def.name.length <= 60, `${def.id} name`);
    assert.ok(
      def.description && def.description.length >= 20,
      `${def.id} description`,
    );
    assert.ok(def.source, `${def.id} source`);
  }
});

test('every feed overlay reads an allowlisted server feed with a matching query mode', () => {
  for (const def of OVERLAY_DEFINITIONS.filter((d) => d.kind === 'feed')) {
    const feed = getOverlayFeed(def.feed);
    assert.ok(feed, `${def.id} → unknown feed ${def.feed}`);
    assert.equal(def.query, feed.query, `${def.id} query mode`);
    if (feed.query === 'bbox') {
      assert.ok(
        def.maxSpanDeg > 0 && def.maxSpanDeg <= feed.maxSpanDeg,
        `${def.id} span`,
      );
      assert.ok(def.maxAltitudeM > 0, `${def.id} must limit altitude`);
    }
  }
});

test('every server feed is used by an overlay or the stats tab', () => {
  const used = new Set(
    OVERLAY_DEFINITIONS.filter((d) => d.kind === 'feed').map((d) => d.feed),
  );
  used.add('swpc-kp');
  for (const id of overlayFeedIds())
    assert.ok(used.has(id), `unused feed ${id}`);
});

test('imagery overlays use https tile templates, WMS layers or the local relay', () => {
  for (const def of OVERLAY_DEFINITIONS.filter((d) => d.kind === 'imagery')) {
    const spec = def.imagery;
    assert.match(
      spec.url,
      /^(https:\/\/|\/api\/overlay-tile\/[a-z0-9-]+\/)/,
      def.id,
    );
    if (spec.url.startsWith('/api/overlay-tile/'))
      assert.ok(
        OVERLAY_TILE_SOURCES[spec.url.split('/')[3]],
        `${def.id} relays an allowlisted tile source`,
      );
    if (spec.provider === 'wms') assert.ok(spec.layers, `${def.id} WMS layer`);
    else
      assert.match(spec.url, /\{z\}.*\{[xy]\}.*\{[xy]\}/, `${def.id} template`);
    assert.ok(spec.maxLevel >= 1 && spec.maxLevel <= 20, `${def.id} maxLevel`);
  }
});

test('OSM overlays filter a real OpenMapTiles layer and only load zoomed in', () => {
  for (const def of OVERLAY_DEFINITIONS.filter((d) => d.kind === 'osm')) {
    assert.ok(
      OSM_LAYERS.has(def.osm.layer),
      `${def.id} layer ${def.osm.layer}`,
    );
    assert.ok(
      def.maxAltitudeM > 0 && def.maxAltitudeM <= 3_000_000,
      `${def.id} altitude`,
    );
    assert.ok(
      def.osm.minZoom >= 0 && def.osm.minZoom <= 14,
      `${def.id} minZoom`,
    );
  }
});

test('computed overlays name a known generator', () => {
  for (const def of OVERLAY_DEFINITIONS.filter((d) => d.kind === 'computed'))
    assert.ok(COMPUTED.has(def.computed), `${def.id} → ${def.computed}`);
});

test('style colors and legends are valid hex', () => {
  const hex = /^#[0-9a-f]{6}$/i;
  for (const def of OVERLAY_DEFINITIONS) {
    if (def.style?.color) assert.match(def.style.color, hex, def.id);
    for (const [, color] of def.legend || [])
      assert.match(color, hex, `${def.id} legend`);
    for (const [, color] of def.style?.colorBy?.stops || [])
      assert.match(color, hex, `${def.id} stops`);
    for (const color of Object.values(def.style?.colorBy?.map || {}))
      assert.match(color, hex, `${def.id} map`);
  }
});

test('keyed overlays name a key the registry and the relay both know', async () => {
  const { knownKeySetupEnvVars } = await import('../keySetupCore.mjs');
  const known = knownKeySetupEnvVars();
  for (const def of OVERLAY_DEFINITIONS.filter((d) => d.requiresKey))
    assert.ok(known.has(def.requiresKey), `${def.id} → ${def.requiresKey}`);
  for (const source of Object.values(OVERLAY_TILE_SOURCES))
    if (source.env) assert.ok(known.has(source.env), source.env);
});

test('the World Statistics category has one choropleth per indicator', async () => {
  const { WORLD_INDICATORS, worldFeedId } =
    await import('./worldIndicators.js');
  for (const indicator of WORLD_INDICATORS) {
    const def = OVERLAY_BY_ID.get(worldFeedId(indicator));
    assert.ok(def, indicator.code);
    assert.equal(def.category, 'world');
    assert.equal(def.style.colorBy.stops.length, 6);
  }
});
