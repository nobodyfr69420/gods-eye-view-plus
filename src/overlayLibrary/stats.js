import { OVERLAY_CATEGORIES, CATEGORY_BY_ID } from './categories.js';
import {
  barList,
  columnStrip,
  el,
  factGrid,
  sparkline,
  statTile,
} from './charts.js';
import { formatAge, formatBytes, formatCount } from './style.js';
import {
  horizonDistanceM,
  maidenheadLocator,
  moonPhaseName,
  solarElevation,
  sublunarPoint,
  subsolarPoint,
} from './computedGeometry.js';

/**
 * STATS tab: live numbers for the whole app — overlays, built-in data layers,
 * rendering, network, the camera, the sun/moon and space weather — plus a
 * per-overlay breakdown. Samples every 2 s into short rolling histories and
 * repaints once a second while visible.
 */

const SAMPLE_MS = 2000;
const HISTORY = 90; // 3 minutes
const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Summaries used by the breakdown card (pure; exported for tests). */
export function summarizeFeatures(
  features,
  { by = null, value = null, top = 10 } = {},
) {
  const groups = new Map();
  const values = [];
  for (const f of features) {
    const p = f?.properties || {};
    if (by) {
      const key =
        p[by] === null || p[by] === undefined || p[by] === ''
          ? 'Unknown'
          : String(p[by]);
      const g = groups.get(key) || { key, count: 0, sum: 0 };
      g.count++;
      const v = value ? Number(p[value]) : NaN;
      if (Number.isFinite(v)) g.sum += v;
      groups.set(key, g);
    }
    if (value) {
      const v = Number(p[value]);
      if (Number.isFinite(v)) values.push(v);
    }
  }
  values.sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    total: features.length,
    groups: [...groups.values()]
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, top),
    distinct: groups.size,
    values: values.length
      ? {
          n: values.length,
          min: values[0],
          p50: percentile(values, 0.5),
          mean: sum / values.length,
          max: values[values.length - 1],
          sum,
        }
      : null,
  };
}

/** NOAA G-scale label for a Kp value. */
export function kpLevel(kp) {
  if (kp >= 9) return { label: 'G5 extreme storm', status: 'critical' };
  if (kp >= 8) return { label: 'G4 severe storm', status: 'critical' };
  if (kp >= 7) return { label: 'G3 strong storm', status: 'critical' };
  if (kp >= 6) return { label: 'G2 moderate storm', status: 'serious' };
  if (kp >= 5) return { label: 'G1 minor storm', status: 'serious' };
  if (kp >= 4) return { label: 'Active', status: 'warning' };
  return { label: 'Quiet', status: 'good' };
}

const fmt = (n, d = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : '—';

export function createStatsView({ container, library, viewer, dataManager }) {
  const scene = viewer.scene;
  const history = { fps: [], features: [], builtIn: [], heap: [] };
  let frames = 0;
  let fps = 0;
  let lastFpsAt = performance.now();
  let visible = false;
  let paintTimer = null;
  let breakdownId = null;
  let kp = null;
  let kpError = null;
  let kpFetchedAt = 0;
  const removePost = scene.postRender.addEventListener(() => {
    frames++;
    const now = performance.now();
    if (now - lastFpsAt >= 1000) {
      fps = (frames * 1000) / (now - lastFpsAt);
      frames = 0;
      lastFpsAt = now;
    }
  });

  function builtInLayers() {
    try {
      return dataManager?.getAll?.() || [];
    } catch {
      return [];
    }
  }

  function sample() {
    const t = Date.now();
    const stats = library.getStats();
    const layers = builtInLayers();
    const builtInTotal = layers
      .filter((l) => l.enabled)
      .reduce((s, l) => s + (Number(l.stats?.count) || 0), 0);
    push(history.fps, { t, v: Math.round(fps * 10) / 10 });
    push(history.features, { t, v: stats.features });
    push(history.builtIn, { t, v: builtInTotal });
    const heap = globalThis.performance?.memory?.usedJSHeapSize;
    if (Number.isFinite(heap)) push(history.heap, { t, v: heap });
  }
  function push(list, point) {
    list.push(point);
    if (list.length > HISTORY) list.shift();
  }
  const sampleTimer = setInterval(sample, SAMPLE_MS);
  sample();

  async function loadKp(force = false) {
    if (!force && Date.now() - kpFetchedAt < 15 * 60_000) return;
    kpFetchedAt = Date.now();
    try {
      const value = await library.feedClient.get(
        'swpc-kp',
        {},
        { maxAgeMs: 15 * 60_000 },
      );
      kp = value.features
        .map((f) => ({
          time: f.properties.time,
          value: Number(f.properties.kp),
        }))
        .filter((v) => Number.isFinite(v.value));
      kpError = null;
    } catch (error) {
      kpError = String(error?.message || error);
    }
    if (visible) paint(true);
  }

  function card(title, ...children) {
    const section = el('section', 'ovl-card');
    section.appendChild(el('h4', 'ovl-card-title', title));
    for (const child of children) if (child) section.appendChild(child);
    return section;
  }

  let hovering = false;
  let lastPaint = 0;
  container.addEventListener('pointerenter', () => (hovering = true));
  container.addEventListener('pointerleave', () => (hovering = false));

  function paint(force = false) {
    if (!visible) return;
    // Hold the frame while the reader is hovering a chart or using a control.
    if (
      !force &&
      (container.contains(document.activeElement) ||
        (hovering && Date.now() - lastPaint < 6000))
    )
      return;
    lastPaint = Date.now();
    const stats = library.getStats();
    const layers = builtInLayers();
    const enabledLayers = layers.filter((l) => l.enabled);
    const builtInTotal = enabledLayers.reduce(
      (s, l) => s + (Number(l.stats?.count) || 0),
      0,
    );
    const view = stats.view;
    const scrollTop = container.scrollTop;
    const frag = document.createDocumentFragment();

    // ── headline tiles ──
    const tiles = el('div', 'ovl-tiles');
    tiles.append(
      statTile(
        'Overlays on',
        `${stats.enabled}`,
        `of ${stats.total} available`,
      ),
      statTile(
        'Overlay features',
        formatCount(stats.features),
        'drawn right now',
      ),
      statTile(
        'Live layer objects',
        formatCount(builtInTotal),
        `${enabledLayers.length} built-in layers on`,
      ),
      statTile(
        'Render rate',
        `${fmt(fps, 0)} fps`,
        'on-demand renderer · idle = 0',
      ),
      statTile(
        'Data loaded',
        formatBytes(stats.feeds.bytes + stats.tiles.bytes),
        `${stats.feeds.requests + stats.tiles.requests} requests`,
      ),
      statTile(
        'Errors',
        String(stats.feeds.errors + stats.tiles.errors),
        stats.feeds.errors + stats.tiles.errors
          ? 'see Network below'
          : 'all sources healthy',
      ),
    );
    frag.appendChild(tiles);

    // ── trends ──
    frag.appendChild(
      card(
        'Trends · last 3 minutes',
        sparkline(history.fps, {
          label: 'Render rate (fps)',
          format: (v) => `${fmt(v, 0)} fps`,
        }),
        sparkline(history.features, {
          label: 'Overlay features drawn',
          format: (v) => formatCount(v),
        }),
        sparkline(history.builtIn, {
          label: 'Built-in layer objects',
          format: (v) => formatCount(v),
        }),
        history.heap.length > 1
          ? sparkline(history.heap, {
              label: 'JavaScript heap',
              format: (v) => formatBytes(v),
            })
          : null,
      ),
    );

    // ── built-in layers ──
    const layerRows = enabledLayers
      .map((l) => ({
        label: l.name || l.id,
        value: Number(l.stats?.count) || 0,
        display: formatCount(Number(l.stats?.count) || 0),
        note: l.stats?.lastUpdate
          ? formatAge(l.stats.lastUpdate)
          : l.stats?.loading
            ? 'loading'
            : '',
      }))
      .sort((a, b) => b.value - a.value);
    const offNames = layers
      .filter((l) => !l.enabled && l.showInTogglePanel !== false)
      .map((l) => l.name || l.id);
    frag.appendChild(
      card(
        `Built-in data layers · ${enabledLayers.length} on`,
        barList(layerRows, {
          emptyText:
            'No built-in layers are on. Open DATA LAYERS to turn on flights, ships, satellites…',
          ariaLabel: 'Objects per built-in layer',
        }),
        offNames.length
          ? el('p', 'ovl-footnote', `Off: ${offNames.join(', ')}`)
          : null,
      ),
    );

    // ── overlays ──
    const overlayRows = stats.overlays
      .map((o) => ({
        label: o.def.name,
        value: Number(o.count) || 0,
        display:
          o.count === null || o.count === undefined
            ? o.status === 'ready'
              ? 'imagery'
              : o.status
            : formatCount(o.count),
        swatch:
          o.def.style?.color || CATEGORY_BY_ID.get(o.def.category)?.accent,
        note: o.status === 'ready' ? '' : o.status,
      }))
      .sort((a, b) => b.value - a.value);
    frag.appendChild(
      card(
        `Active overlays · ${stats.enabled}`,
        barList(overlayRows, {
          emptyText: 'No overlays on yet.',
          ariaLabel: 'Features per active overlay',
        }),
      ),
    );

    // ── categories ──
    const enabledByCat = new Map();
    for (const o of stats.overlays)
      enabledByCat.set(
        o.def.category,
        (enabledByCat.get(o.def.category) || 0) + 1,
      );
    const totalByCat = new Map();
    for (const d of library.definitions)
      totalByCat.set(d.category, (totalByCat.get(d.category) || 0) + 1);
    frag.appendChild(
      card(
        'Library by category',
        barList(
          OVERLAY_CATEGORIES.filter((c) => totalByCat.get(c.id)).map((c) => ({
            label: `${c.glyph}  ${c.name}`,
            value: totalByCat.get(c.id),
            display: enabledByCat.get(c.id)
              ? `${enabledByCat.get(c.id)} on / ${totalByCat.get(c.id)}`
              : String(totalByCat.get(c.id)),
          })),
          { ariaLabel: 'Overlays per category' },
        ),
      ),
    );

    // ── breakdown ──
    const candidates = stats.overlays.filter(
      (o) => (o.def.statsBy || o.def.statsValue) && o.def.kind !== 'imagery',
    );
    if (candidates.length) {
      if (!candidates.some((o) => o.id === breakdownId))
        breakdownId = candidates[0].id;
      const select = el('select', 'ovl-select');
      select.setAttribute('aria-label', 'Overlay to break down');
      for (const o of candidates) {
        const option = el('option', '', o.def.name);
        option.value = o.id;
        option.selected = o.id === breakdownId;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        breakdownId = select.value;
        select.blur();
        paint(true);
      });
      for (const type of ['keydown', 'keyup'])
        select.addEventListener(type, (e) => e.stopPropagation());
      const def = candidates.find((o) => o.id === breakdownId).def;
      const summary = summarizeFeatures(library.getFeatures(breakdownId), {
        by: def.statsBy,
        value: def.statsValue,
      });
      const parts = [select];
      if (summary.values) {
        const unit =
          def.statsValue === 'capacity_mw'
            ? ' MW'
            : def.statsValue === 'population'
              ? ''
              : '';
        parts.push(
          factGrid([
            ['Features', fmt(summary.total)],
            [
              `Total ${def.statsValue}`,
              `${fmt(summary.values.sum, summary.values.sum < 100 ? 1 : 0)}${unit}`,
            ],
            [
              'Median',
              fmt(summary.values.p50, summary.values.p50 < 100 ? 1 : 0),
            ],
            [
              'Mean',
              fmt(summary.values.mean, summary.values.mean < 100 ? 1 : 0),
            ],
            ['Max', fmt(summary.values.max, summary.values.max < 100 ? 1 : 0)],
            ['Min', fmt(summary.values.min, summary.values.min < 100 ? 1 : 0)],
          ]),
        );
      } else parts.push(factGrid([['Features', fmt(summary.total)]]));
      if (def.statsBy) {
        parts.push(
          el(
            'p',
            'ovl-footnote',
            `Top ${summary.groups.length} of ${summary.distinct} by ${def.statsBy}`,
          ),
        );
        parts.push(
          barList(
            summary.groups.map((g) => ({
              label: g.key,
              value: g.count,
              display:
                def.statsValue && g.sum
                  ? `${fmt(g.count)} · Σ ${formatCount(g.sum)}`
                  : fmt(g.count),
            })),
            { ariaLabel: `Breakdown by ${def.statsBy}` },
          ),
        );
      }
      frag.appendChild(card('Breakdown', ...parts));
    }

    // ── sun, moon, space weather ──
    const now = new Date();
    const sun = subsolarPoint(now);
    const moon = sublunarPoint(now);
    const center = view.center;
    const sunHere = center
      ? solarElevation(center.lat, center.lon, now, sun)
      : null;
    const sky = [
      factGrid([
        ['Sun overhead at', `${fmt(sun.lat, 1)}°, ${fmt(sun.lon, 1)}°`],
        [
          'Sun at view center',
          sunHere === null
            ? null
            : `${fmt(sunHere, 1)}° ${sunHere >= 0 ? 'above' : 'below'} horizon`,
        ],
        [
          'Moon',
          `${moonPhaseName(moon.phase, moon.fraction)} · ${Math.round(moon.fraction * 100)}% lit`,
        ],
        ['Moon distance', `${fmt(moon.distanceKm)} km`],
      ]),
    ];
    if (kp?.length) {
      const latest = kp[kp.length - 1];
      const level = kpLevel(latest.value);
      const badge = el('div', 'ovl-kp');
      const dot = el('span', 'ovl-status-dot');
      dot.style.setProperty('--ovl-color', STATUS[level.status]);
      dot.setAttribute('aria-hidden', 'true');
      badge.append(
        dot,
        el('strong', '', `Kp ${fmt(latest.value, 1)}`),
        el('span', '', ` · ${level.label}`),
      );
      sky.push(badge);
      sky.push(
        columnStrip(kp.slice(-56), {
          max: 9,
          colorFor: (v) => STATUS[kpLevel(v.value).status],
          titleFor: (v) =>
            `${v.time.replace('T', ' ').slice(0, 16)} UTC · Kp ${fmt(v.value, 2)} · ${kpLevel(v.value).label}`,
        }),
      );
      sky.push(
        el(
          'p',
          'ovl-footnote',
          'Planetary K-index, 3-hour values over the last 7 days (NOAA SWPC). Hover a column for its time.',
        ),
      );
    } else {
      sky.push(
        el(
          'p',
          'ovl-footnote',
          kpError
            ? `Space weather unavailable: ${kpError}`
            : 'Loading planetary K-index…',
        ),
      );
    }
    frag.appendChild(card('Sun · Moon · Space weather', ...sky));

    // ── camera & scene ──
    let entities = 0;
    try {
      for (let i = 0; i < viewer.dataSources.length; i++)
        entities += viewer.dataSources.get(i).entities.values.length;
    } catch {
      /* data sources may be mid-teardown */
    }
    frag.appendChild(
      card(
        'Camera & scene',
        factGrid([
          [
            'Camera altitude',
            view.altitude >= 1000
              ? `${fmt(view.altitude / 1000, view.altitude < 1e5 ? 1 : 0)} km`
              : `${fmt(view.altitude)} m`,
          ],
          [
            'View center',
            center ? `${fmt(center.lat, 4)}°, ${fmt(center.lon, 4)}°` : null,
          ],
          [
            'Maidenhead',
            center ? maidenheadLocator(center.lat, center.lon) : null,
          ],
          [
            'Horizon distance',
            `${fmt(horizonDistanceM(view.altitude) / 1000)} km`,
          ],
          ['Scene primitives', fmt(scene.primitives.length)],
          ['Ground primitives', fmt(scene.groundPrimitives?.length ?? 0)],
          ['Imagery layers', fmt(viewer.imageryLayers?.length ?? 0)],
          [
            'Data sources · entities',
            `${fmt(viewer.dataSources?.length ?? 0)} · ${fmt(entities)}`,
          ],
          ['Globe', scene.globe?.show ? 'Imagery globe' : '3D tiles'],
          [
            'Session uptime',
            formatAge(Date.now() - stats.uptimeMs).replace(' ago', ''),
          ],
        ]),
      ),
    );

    // ── network ──
    const recent = stats.feedHistory.slice(-8).reverse();
    const net = [
      factGrid([
        [
          'Feed requests',
          `${fmt(stats.feeds.requests)} (${fmt(stats.feeds.cacheHits)} cache hits)`,
        ],
        ['Feed data', formatBytes(stats.feeds.bytes)],
        ['Feed errors', fmt(stats.feeds.errors)],
        [
          'Avg feed time',
          stats.feeds.requests
            ? `${fmt(stats.feeds.totalMs / stats.feeds.requests)} ms`
            : null,
        ],
        [
          'OSM tiles fetched',
          `${fmt(stats.tiles.requests)} · ${formatBytes(stats.tiles.bytes)}`,
        ],
        ['OSM tiles cached', fmt(stats.tiles.cached)],
      ]),
    ];
    if (recent.length) {
      const ul = el('ul', 'ovl-log');
      for (const r of recent) {
        const li = el('li', r.ok ? '' : 'is-error');
        const dot = el('span', 'ovl-status-dot');
        dot.style.setProperty(
          '--ovl-color',
          r.ok ? STATUS.good : STATUS.critical,
        );
        dot.setAttribute('aria-hidden', 'true');
        li.append(
          dot,
          el('span', 'ovl-log-name', r.feedId),
          el(
            'span',
            'ovl-log-meta',
            r.ok
              ? `${fmt(r.ms)} ms · ${formatBytes(r.bytes)}`
              : `failed · ${r.error || ''}`,
          ),
        );
        ul.appendChild(li);
      }
      net.push(ul);
    }
    frag.appendChild(card('Network', ...net));

    // ── actions ──
    const actions = el('div', 'ovl-actions');
    const exportBtn = el('button', 'ovl-mini-btn', '⤓ Export stats (JSON)');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', exportJson);
    actions.appendChild(exportBtn);
    frag.appendChild(actions);

    container.replaceChildren(frag);
    container.scrollTop = scrollTop;
  }

  function exportJson() {
    const stats = library.getStats();
    const payload = {
      exportedAt: new Date().toISOString(),
      overlays: stats.overlays.map((o) => ({
        id: o.id,
        name: o.def.name,
        status: o.status,
        count: o.count,
        loadMs: o.loadMs,
        lastUpdate: o.lastUpdate,
      })),
      builtInLayers: builtInLayers().map((l) => ({
        id: l.id,
        name: l.name,
        enabled: l.enabled,
        count: l.stats?.count ?? 0,
        lastUpdate: l.stats?.lastUpdate ?? null,
      })),
      feeds: stats.feeds,
      tiles: stats.tiles,
      view: { altitude: stats.view.altitude, center: stats.view.center },
      fps,
      history,
      kp,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gev-stats-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return {
    setVisible(next) {
      visible = next;
      clearInterval(paintTimer);
      if (visible) {
        loadKp();
        paint(true);
        paintTimer = setInterval(paint, 1000);
      }
    },
    paint,
    destroy() {
      clearInterval(paintTimer);
      clearInterval(sampleTimer);
      removePost();
      container.replaceChildren();
    },
  };
}
