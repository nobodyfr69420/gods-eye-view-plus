import { OVERLAY_CATEGORIES } from './categories.js';
import { formatAge, formatCount } from './style.js';

/**
 * The OVERLAYS panel body: LIBRARY (searchable, categorized catalog),
 * ACTIVE (what is on, with opacity and status) and STATS (mounted by the
 * stats view). Built with DOM APIs only — every catalog string is set with
 * textContent, never innerHTML.
 */

const KIND_LABEL = {
  imagery: 'Imagery',
  feed: 'Live / data feed',
  osm: 'OpenStreetMap (zoomed in)',
  computed: 'Computed',
  local: 'On this device',
};
const KIND_FILTERS = [
  ['all', 'All'],
  ['live', 'Live'],
  ['imagery', 'Imagery'],
  ['feed', 'Data'],
  ['osm', 'OSM'],
  ['computed', 'Computed'],
  ['favorites', '★'],
];
/** Panel tabs: the catalog, what is on, live numbers, World Statistics, ME. */
const TABS = [
  ['library', 'LIBRARY'],
  ['active', 'ACTIVE'],
  ['stats', 'STATS'],
  ['world', 'WORLD'],
  ['me', 'ME'],
];
const STATUS_TEXT = {
  off: 'OFF',
  loading: 'LOADING',
  ready: 'ON',
  stale: 'CACHED',
  zoom: 'ZOOM IN',
  hidden: 'HIDDEN',
  error: 'ERROR',
};
const STATUS_CLASS = {
  loading: 'feed-loading',
  stale: 'feed-stale',
  zoom: 'feed-partial',
  hidden: 'feed-degraded',
  error: 'feed-unavailable',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function createOverlayPanel({ root, library, onTabChange }) {
  const removers = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    removers.push(() => target.removeEventListener(type, fn, opts));
  };
  const rows = new Map(); // id → { row, toggle, count, meta, details, slider }
  const activeRows = new Map();
  const groups = new Map();
  let query = '';
  let kindFilter = 'all';
  let tab = 'library';
  let expanded = null;
  let frame = 0;

  root.replaceChildren();
  root.classList.add('ovl-root');

  // ── tabs ───────────────────────────────────────────────────────────────
  const tabs = el('div', 'ovl-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = {};
  const panels = {};
  for (const [id, label] of TABS) {
    const button = el('button', 'ovl-tab');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.id = `ovl-tab-${id}`;
    button.dataset.tab = id;
    const name = el('span', 'ovl-tab-label', label);
    const badge = el('span', 'ovl-tab-badge');
    button.append(name, badge);
    tabButtons[id] = { button, badge };
    tabs.appendChild(button);
    const panel = el('div', 'ovl-tabpanel');
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.dataset.tab = id;
    panels[id] = panel;
  }
  root.appendChild(tabs);
  for (const panel of Object.values(panels)) root.appendChild(panel);
  on(tabs, 'click', (event) => {
    const button = event.target.closest('.ovl-tab');
    if (button) setTab(button.dataset.tab);
  });
  on(tabs, 'keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const order = TABS.map(([id]) => id);
    const next =
      order[
        (order.indexOf(tab) +
          (event.key === 'ArrowRight' ? 1 : order.length - 1)) %
          order.length
      ];
    setTab(next);
    tabButtons[next].button.focus();
    event.preventDefault();
  });

  function setTab(next) {
    tab = next;
    for (const [id, { button }] of Object.entries(tabButtons)) {
      const selected = id === tab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      panels[id].hidden = !selected;
    }
    if (tab === 'active') renderActive();
    onTabChange?.(tab);
  }

  // ── library tab ────────────────────────────────────────────────────────
  const libraryPanel = panels.library;
  const search = el('input', 'ovl-search');
  search.type = 'search';
  search.placeholder = `Search ${library.definitions.length} overlays…`;
  search.setAttribute('aria-label', 'Search overlays');
  search.autocomplete = 'off';
  search.spellcheck = false;
  const chips = el('div', 'ovl-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Filter overlays by type');
  for (const [id, label] of KIND_FILTERS) {
    const chip = el('button', 'ovl-chip', label);
    chip.type = 'button';
    chip.dataset.kind = id;
    chip.setAttribute('aria-pressed', String(id === kindFilter));
    if (id === 'favorites') chip.title = 'Favorites';
    chips.appendChild(chip);
  }
  const summary = el('div', 'ovl-summary');
  summary.setAttribute('aria-live', 'polite');
  const list = el('div', 'ovl-list');
  libraryPanel.append(search, chips, summary, list);

  on(search, 'input', () => {
    query = search.value.trim().toLowerCase();
    applyFilter();
  });
  // Keep typing inside the search box from reaching the app's global
  // keyboard shortcuts (1–7 styles, H, D, C…).
  for (const type of ['keydown', 'keyup', 'keypress'])
    on(search, type, (event) => event.stopPropagation());
  on(chips, 'click', (event) => {
    const chip = event.target.closest('.ovl-chip');
    if (!chip) return;
    kindFilter = chip.dataset.kind;
    for (const c of chips.children)
      c.setAttribute('aria-pressed', String(c.dataset.kind === kindFilter));
    applyFilter();
  });

  const byCategory = new Map(OVERLAY_CATEGORIES.map((c) => [c.id, []]));
  for (const def of library.definitions) {
    if (!byCategory.has(def.category)) byCategory.set(def.category, []);
    byCategory.get(def.category).push(def);
  }
  for (const category of OVERLAY_CATEGORIES) {
    const defs = byCategory.get(category.id) || [];
    if (!defs.length) continue;
    const group = el('details', 'ovl-group');
    group.dataset.category = category.id;
    const head = el('summary', 'ovl-group-head');
    const glyph = el('span', 'ovl-group-glyph', category.glyph);
    glyph.style.setProperty('--ovl-accent', category.accent);
    glyph.setAttribute('aria-hidden', 'true');
    const name = el('span', 'ovl-group-name', category.name);
    const count = el('span', 'ovl-group-count');
    head.append(glyph, name, count);
    const body = el('div', 'ovl-group-body');
    group.append(head, body);
    for (const def of defs) body.appendChild(buildRow(def));
    groups.set(category.id, { group, count, defs });
    list.appendChild(group);
  }
  // Open the first group so the panel never looks empty.
  list.querySelector('.ovl-group')?.setAttribute('open', '');

  function buildRow(def) {
    const row = el('div', 'data-toggle-row ovl-row');
    row.dataset.overlayId = def.id;
    const top = el('div', 'data-toggle-top');
    const left = el('button', 'data-toggle-left ovl-row-name');
    left.type = 'button';
    left.setAttribute('aria-expanded', 'false');
    left.title = 'Details';
    const swatch = el('span', 'ovl-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.setProperty('--ovl-color', def.style?.color || accentFor(def));
    swatch.dataset.kind = def.kind;
    const name = el('span', 'data-name', def.name);
    left.append(swatch, name);
    const right = el('div', 'data-toggle-right');
    const count = el('span', 'data-count');
    const toggle = el('button', 'data-toggle-btn', 'OFF');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', `Toggle ${def.name}`);
    right.append(count, toggle);
    top.append(left, right);
    const meta = el(
      'div',
      'data-toggle-meta ovl-meta',
      `${def.source} · ${KIND_LABEL[def.kind] || def.kind}`,
    );
    row.append(top, meta);
    on(toggle, 'click', () => library.toggle(def.id));
    on(left, 'click', () => toggleDetails(def, row, left));
    rows.set(def.id, { row, toggle, count, meta, left });
    return row;
  }

  function accentFor(def) {
    return (
      OVERLAY_CATEGORIES.find((c) => c.id === def.category)?.accent || '#00d4ff'
    );
  }

  function toggleDetails(def, row, button) {
    const existing = row.querySelector('.ovl-details');
    if (existing) {
      existing.remove();
      button.setAttribute('aria-expanded', 'false');
      if (expanded === def.id) expanded = null;
      return;
    }
    if (expanded && expanded !== def.id) {
      const prev = rows.get(expanded);
      prev?.row.querySelector('.ovl-details')?.remove();
      prev?.left.setAttribute('aria-expanded', 'false');
    }
    expanded = def.id;
    button.setAttribute('aria-expanded', 'true');
    row.appendChild(buildDetails(def));
  }

  function buildDetails(def, { compact = false } = {}) {
    const details = el('div', 'ovl-details');
    if (!compact) details.appendChild(el('p', 'ovl-desc', def.description));
    if (def.legend?.length) {
      const legend = el('div', 'ovl-legend');
      for (const [label, color] of def.legend) {
        const item = el('span', 'ovl-legend-item');
        const dot = el('span', 'ovl-legend-dot');
        dot.style.setProperty('--ovl-color', color);
        dot.setAttribute('aria-hidden', 'true');
        item.append(dot, el('span', '', label));
        legend.appendChild(item);
      }
      details.appendChild(legend);
    }
    const facts = el('div', 'ovl-facts');
    const fact = (label, value) => {
      if (!value) return;
      const f = el('span', 'ovl-fact');
      f.append(
        el('span', 'ovl-fact-label', label),
        el('span', 'ovl-fact-value', value),
      );
      facts.appendChild(f);
    };
    fact('Source', def.source);
    fact('Type', KIND_LABEL[def.kind]);
    if (def.refreshMs)
      fact('Refresh', `every ${Math.round(def.refreshMs / 60000)} min`);
    if (def.maxAltitudeM)
      fact(
        'Shows below',
        `${Math.round(def.maxAltitudeM / 1000).toLocaleString('en-US')} km altitude`,
      );
    details.appendChild(facts);

    const controls = el('div', 'ovl-controls');
    const label = el('label', 'ovl-opacity');
    label.append(el('span', 'ovl-fact-label', 'Opacity'));
    const slider = el('input', 'ovl-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.value = String(
      Math.round((library.getState(def.id).alpha ?? 1) * 100),
    );
    slider.setAttribute('aria-label', `${def.name} opacity`);
    const value = el('span', 'ovl-slider-value', `${slider.value}%`);
    label.append(slider, value);
    slider.addEventListener('input', () => {
      value.textContent = `${slider.value}%`;
      library.setAlpha(def.id, Number(slider.value) / 100);
    });
    const fav = el(
      'button',
      'ovl-mini-btn',
      library.isFavorite(def.id) ? '★ Saved' : '☆ Favorite',
    );
    fav.type = 'button';
    fav.addEventListener('click', () => {
      library.toggleFavorite(def.id);
      fav.textContent = library.isFavorite(def.id) ? '★ Saved' : '☆ Favorite';
    });
    const reload = el('button', 'ovl-mini-btn', '↻ Reload');
    reload.type = 'button';
    reload.addEventListener('click', () => library.reload(def.id));
    controls.append(label, fav, reload);
    details.appendChild(controls);
    const status = el('div', 'ovl-status-line');
    status.dataset.statusFor = def.id;
    details.appendChild(status);
    syncStatusLine(status, def.id);
    return details;
  }

  function syncStatusLine(node, id) {
    const s = library.getState(id);
    if (!s.enabled) {
      node.textContent = 'Off';
      return;
    }
    const parts = [];
    if (s.status === 'error') parts.push(`Error: ${s.message}`);
    else if (s.message) parts.push(s.message);
    if (Number.isFinite(s.count) && s.count !== null)
      parts.push(`${s.count.toLocaleString('en-US')} drawn`);
    if (s.loadMs !== null && s.loadMs !== undefined)
      parts.push(`${s.loadMs} ms`);
    if (s.lastUpdate) parts.push(`updated ${formatAge(s.lastUpdate)}`);
    node.textContent = parts.join(' · ') || STATUS_TEXT[s.status] || '';
  }

  function matches(def) {
    if (kindFilter === 'live' && !def.refreshMs) return false;
    if (kindFilter === 'favorites' && !library.isFavorite(def.id)) return false;
    if (
      !['all', 'live', 'favorites'].includes(kindFilter) &&
      def.kind !== kindFilter
    )
      return false;
    if (!query) return true;
    const hay =
      `${def.name} ${def.source} ${def.description} ${def.category} ${def.tags || ''}`.toLowerCase();
    return query.split(/\s+/).every((term) => hay.includes(term));
  }

  function applyFilter() {
    let shown = 0;
    for (const [, g] of groups) {
      let visible = 0;
      for (const def of g.defs) {
        const ok = matches(def);
        rows.get(def.id).row.hidden = !ok;
        if (ok) visible++;
      }
      g.group.hidden = visible === 0;
      if (query || kindFilter !== 'all') {
        if (visible) g.group.open = true;
      }
      shown += visible;
    }
    summary.textContent =
      query || kindFilter !== 'all'
        ? `${shown} of ${library.definitions.length} overlays match`
        : `${library.definitions.length} overlays in ${groups.size} categories · tap a name for details`;
  }

  // ── active tab ─────────────────────────────────────────────────────────
  const activePanel = panels.active;
  const activeHead = el('div', 'ovl-active-head');
  const activeTitle = el('span', 'ovl-summary');
  const clearAll = el('button', 'ovl-mini-btn ovl-danger', 'Clear all');
  clearAll.type = 'button';
  on(clearAll, 'click', () => library.clearAll());
  activeHead.append(activeTitle, clearAll);
  const activeList = el('div', 'ovl-active-list');
  const empty = el(
    'p',
    'ovl-empty',
    'No overlays are on. Turn some on in LIBRARY — try “Night Side”, “Major Airports” or “Significant Earthquakes”.',
  );
  activePanel.append(activeHead, activeList, empty);

  function renderActive() {
    const ids = library.activeIds;
    activeTitle.textContent = `${ids.length} overlay${ids.length === 1 ? '' : 's'} on`;
    clearAll.hidden = !ids.length;
    empty.hidden = ids.length > 0;
    for (const [id, entry] of activeRows) {
      if (!ids.includes(id)) {
        entry.row.remove();
        activeRows.delete(id);
      }
    }
    for (const id of ids) {
      if (activeRows.has(id)) continue;
      const def = library.definitions.find((d) => d.id === id);
      if (!def) continue;
      const row = el('div', 'data-toggle-row ovl-row ovl-active-row');
      const top = el('div', 'data-toggle-top');
      const left = el('div', 'data-toggle-left');
      const swatch = el('span', 'ovl-swatch');
      swatch.style.setProperty(
        '--ovl-color',
        def.style?.color || accentFor(def),
      );
      swatch.dataset.kind = def.kind;
      swatch.setAttribute('aria-hidden', 'true');
      left.append(swatch, el('span', 'data-name', def.name));
      const right = el('div', 'data-toggle-right');
      const count = el('span', 'data-count');
      const toggle = el('button', 'data-toggle-btn active', 'ON');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', `Turn off ${def.name}`);
      toggle.addEventListener('click', () => library.disable(id));
      right.append(count, toggle);
      top.append(left, right);
      row.append(top, buildDetails(def, { compact: true }));
      activeRows.set(id, { row, count, toggle });
      activeList.appendChild(row);
    }
  }

  // ── status sync ────────────────────────────────────────────────────────
  function sync() {
    frame = 0;
    let enabledCount = 0;
    const perCategory = new Map();
    for (const def of library.definitions) {
      const s = library.getState(def.id);
      const entry = rows.get(def.id);
      if (s.enabled) {
        enabledCount++;
        perCategory.set(def.category, (perCategory.get(def.category) || 0) + 1);
      }
      if (!entry) continue;
      const status = s.enabled ? s.status : 'off';
      entry.toggle.textContent = STATUS_TEXT[status] || 'ON';
      entry.toggle.className = `data-toggle-btn${s.enabled ? ' active' : ''}${STATUS_CLASS[status] ? ` ${STATUS_CLASS[status]}` : ''}`;
      entry.toggle.setAttribute('aria-pressed', String(s.enabled));
      entry.toggle.title =
        s.enabled && s.message ? s.message : s.enabled ? 'Turn off' : 'Turn on';
      entry.count.textContent =
        s.enabled && Number.isFinite(s.count) && s.count !== null
          ? formatCount(s.count)
          : '';
      entry.row.classList.toggle('is-on', s.enabled);
      const line = entry.row.querySelector('.ovl-status-line');
      if (line) syncStatusLine(line, def.id);
      const a = activeRows.get(def.id);
      if (a) {
        a.toggle.textContent = STATUS_TEXT[status] || 'ON';
        a.toggle.className = `data-toggle-btn active${STATUS_CLASS[status] ? ` ${STATUS_CLASS[status]}` : ''}`;
        a.count.textContent =
          Number.isFinite(s.count) && s.count !== null
            ? formatCount(s.count)
            : '';
        const l = a.row.querySelector('.ovl-status-line');
        if (l) syncStatusLine(l, def.id);
      }
    }
    for (const [id, g] of groups) {
      const n = perCategory.get(id) || 0;
      g.count.textContent = n
        ? `${n} on · ${g.defs.length}`
        : String(g.defs.length);
      g.group.classList.toggle('has-active', n > 0);
    }
    const notice = library.getNotices?.().at(-1);
    if (notice && Date.now() - notice.at < 120_000) {
      summary.textContent = `⚠ ${notice.name} was turned off after a rendering error.`;
      summary.classList.add('is-warning');
    } else if (summary.classList.contains('is-warning')) {
      summary.classList.remove('is-warning');
      applyFilter();
    }
    tabButtons.active.badge.textContent = enabledCount
      ? String(enabledCount)
      : '';
    tabButtons.library.badge.textContent = String(library.definitions.length);
    if (tab === 'active') renderActive();
  }
  function scheduleSync() {
    if (frame) return;
    frame = requestAnimationFrame(sync);
  }
  removers.push(library.subscribe(scheduleSync));
  // Ages ("updated 3m ago") tick even when nothing else changes.
  const ageTimer = setInterval(scheduleSync, 15_000);
  removers.push(() => clearInterval(ageTimer));

  setTab('library');
  applyFilter();
  sync();

  return {
    get statsContainer() {
      return panels.stats;
    },
    panelFor: (id) => panels[id] ?? null,
    setTab,
    get tab() {
      return tab;
    },
    focusSearch() {
      setTab('library');
      search.focus();
    },
    destroy() {
      cancelAnimationFrame(frame);
      for (const remove of removers.splice(0)) remove();
      root.replaceChildren();
    },
  };
}
