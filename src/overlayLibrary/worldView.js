import * as Cesium from 'cesium';
import { barList, el, factGrid, statTile } from './charts.js';
import {
  WORLD_GROUPS,
  WORLD_INDICATORS,
  WORLD_INDICATOR_BY_CODE,
  WORLD_INDICATOR_BY_SLUG,
  classOf,
  formatIndicator,
  indicatorRamp,
  indicatorText,
  quantileBreaks,
  worldFeedId,
} from './worldIndicators.js';

/**
 * WORLD tab: World Statistics.
 *  - live world clock (population, births and deaths today — estimates);
 *  - the world at a glance (World Bank WLD aggregates);
 *  - map any of 74 indicators as a country choropleth, with real class
 *    breaks, top/bottom rankings and the distribution;
 *  - a country fact sheet (click a shaded country or pick one).
 * All text is set with textContent.
 */

const YEAR_MS = 365.2425 * 86_400_000;
const GLANCE = [
  'NY.GDP.MKTP.CD',
  'NY.GDP.PCAP.CD',
  'SP.DYN.LE00.IN',
  'SP.URB.TOTL.IN.ZS',
  'IT.NET.USER.ZS',
  'EG.ELC.ACCS.ZS',
  'EN.GHG.CO2.PC.CE.AR5',
  'AG.LND.FRST.ZS',
  'SP.DYN.TFRT.IN',
  'SI.POV.DDAY',
  'MS.MIL.XPND.GD.ZS',
  'SE.ADT.LITR.ZS',
];

/**
 * Population clock (pure; exported for tests). Anchors World Bank's
 * mid-year population for `year` at 1 July and grows it continuously at the
 * annual growth rate; births/deaths come from crude rates per 1,000.
 */
export function worldClock(
  { population, year, growthPct, birthRate, deathRate },
  now = Date.now(),
) {
  if (![population, year].every(Number.isFinite)) return null;
  const anchor = Date.UTC(year, 6, 1);
  const years = (now - anchor) / YEAR_MS;
  const growth = Number.isFinite(growthPct) ? growthPct / 100 : 0.009;
  const pop = population * Math.exp(Math.log1p(growth) * years);
  const perSecond = (rate) =>
    Number.isFinite(rate) ? ((rate / 1000) * pop) / (YEAR_MS / 1000) : null;
  const birthsPerSec = perSecond(birthRate);
  const deathsPerSec = perSecond(deathRate);
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const secondsToday = (now - midnight.getTime()) / 1000;
  return {
    population: pop,
    birthsPerSec,
    deathsPerSec,
    birthsToday: birthsPerSec === null ? null : birthsPerSec * secondsToday,
    deathsToday: deathsPerSec === null ? null : deathsPerSec * secondsToday,
  };
}

export function createWorldView({ container, library, viewer, fetchImpl }) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  let destroyed = false;
  let visible = false;
  let summary = null;
  let clockTimer = 0;
  let current = WORLD_INDICATOR_BY_SLUG.get('gdp-per-capita');
  let rows = []; // features of the current indicator
  let sheetIso = null;
  const removers = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    removers.push(() => target.removeEventListener(type, fn));
  };

  function card(title, ...children) {
    const section = el('section', 'ovl-card');
    section.appendChild(el('h4', 'ovl-card-title', title));
    for (const child of children) if (child) section.appendChild(child);
    return section;
  }

  container.replaceChildren();
  container.classList.add('ovl-world');

  // ── live clock ─────────────────────────────────────────────────────────
  const clockTiles = el('div', 'ovl-tiles');
  const clockNote = el(
    'p',
    'ovl-footnote',
    'Estimates, not counts: World Bank mid-year population grown at its annual rate, with births and deaths from crude rates. Loading…',
  );
  container.appendChild(card('WORLD CLOCK', clockTiles, clockNote));

  // ── glance ─────────────────────────────────────────────────────────────
  const glance = el('div', 'ovl-world-glance');
  container.appendChild(card('THE WORLD AT A GLANCE', glance));

  // ── map an indicator ──────────────────────────────────────────────────
  const groupSelect = el('select', 'ovl-select');
  groupSelect.setAttribute('aria-label', 'Indicator group');
  for (const group of WORLD_GROUPS) {
    const option = el('option', '', group.name);
    option.value = group.id;
    groupSelect.appendChild(option);
  }
  const indicatorSelect = el('select', 'ovl-select');
  indicatorSelect.setAttribute('aria-label', 'Indicator');
  const mapButton = el('button', 'ovl-mini-btn', 'SHADE MAP');
  mapButton.type = 'button';
  const clearButton = el('button', 'ovl-mini-btn', 'CLEAR');
  clearButton.type = 'button';
  const pickers = el('div', 'ovl-world-pickers');
  const actions = el('div', 'ovl-actions');
  actions.append(mapButton, clearButton);
  pickers.append(groupSelect, indicatorSelect, actions);
  const legend = el('div', 'ovl-world-legend');
  const summaryLine = el('p', 'ovl-footnote');
  const rankTop = el('div');
  const rankBottom = el('div');
  container.appendChild(
    card(
      'MAP AN INDICATOR',
      pickers,
      summaryLine,
      legend,
      el('div', 'ovl-world-subhead', 'HIGHEST'),
      rankTop,
      el('div', 'ovl-world-subhead', 'LOWEST'),
      rankBottom,
    ),
  );

  // ── country sheet ─────────────────────────────────────────────────────
  const countrySelect = el('select', 'ovl-select');
  countrySelect.setAttribute('aria-label', 'Country');
  const sheet = el('div', 'ovl-world-sheet');
  sheet.appendChild(
    el('p', 'ovl-empty', 'Click a shaded country on the globe, or pick one.'),
  );
  container.appendChild(card('COUNTRY FACT SHEET', countrySelect, sheet));
  container.appendChild(
    el(
      'p',
      'ovl-footnote',
      'Data: World Bank World Development Indicators (CC BY 4.0), Natural Earth, Wikipedia. Each country shows its most recent reported year.',
    ),
  );

  function fillIndicators() {
    indicatorSelect.replaceChildren();
    for (const indicator of WORLD_INDICATORS.filter(
      (i) => i.group === groupSelect.value,
    )) {
      const option = el('option', '', indicator.name);
      option.value = indicator.slug;
      indicatorSelect.appendChild(option);
    }
    if (current?.group === groupSelect.value)
      indicatorSelect.value = current.slug;
  }
  groupSelect.value = current.group;
  fillIndicators();

  on(groupSelect, 'change', () => {
    fillIndicators();
    selectIndicator(indicatorSelect.value, false);
  });
  on(indicatorSelect, 'change', () =>
    selectIndicator(indicatorSelect.value, false),
  );
  on(mapButton, 'click', () => selectIndicator(indicatorSelect.value, true));
  on(clearButton, 'click', () => {
    for (const indicator of WORLD_INDICATORS)
      library.disable(worldFeedId(indicator));
  });
  on(countrySelect, 'change', () => {
    if (countrySelect.value) showCountry(countrySelect.value);
  });

  async function loadSummary() {
    try {
      const response = await doFetch('/api/world-stats/summary');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      summary = await response.json();
      if (destroyed) return;
      paintGlance();
      paintClock();
    } catch (error) {
      clockNote.textContent = `World totals unavailable (${error.message}).`;
    }
  }

  function worldValue(code) {
    return summary?.world?.[code] ?? null;
  }

  function paintGlance() {
    const entries = [];
    for (const code of GLANCE) {
      const indicator = WORLD_INDICATOR_BY_CODE.get(code);
      const v = worldValue(code);
      if (!indicator || !v) continue;
      entries.push([
        `${indicator.name} (${v.year})`,
        indicatorText(v.value, indicator),
      ]);
    }
    glance.replaceChildren(factGrid(entries));
  }

  function paintClock() {
    const pop = worldValue('SP.POP.TOTL');
    const clock = pop
      ? worldClock({
          population: pop.value,
          year: pop.year,
          growthPct: worldValue('SP.POP.GROW')?.value,
          birthRate: worldValue('SP.DYN.CBRT.IN')?.value,
          deathRate: worldValue('SP.DYN.CDRT.IN')?.value,
        })
      : null;
    if (!clock) return;
    const fmt = (n) =>
      n === null ? '—' : Math.round(n).toLocaleString('en-US');
    clockTiles.replaceChildren(
      statTile('POPULATION NOW', fmt(clock.population), 'estimated'),
      statTile(
        'BIRTHS TODAY',
        fmt(clock.birthsToday),
        `${clock.birthsPerSec?.toFixed(1)} / second · UTC day`,
      ),
      statTile(
        'DEATHS TODAY',
        fmt(clock.deathsToday),
        `${clock.deathsPerSec?.toFixed(1)} / second · UTC day`,
      ),
      statTile(
        'NET GROWTH TODAY',
        fmt((clock.birthsToday ?? 0) - (clock.deathsToday ?? 0)),
        'births − deaths',
      ),
    );
    clockNote.textContent = `Estimates, not counts: World Bank ${pop.year} mid-year population grown at ${worldValue('SP.POP.GROW')?.value?.toFixed(2) ?? '0.9'}%/yr; births and deaths from crude rates (per 1,000). Migration nets to zero worldwide.`;
  }

  async function selectIndicator(slug, shade) {
    const indicator = WORLD_INDICATOR_BY_SLUG.get(slug);
    if (!indicator) return;
    current = indicator;
    if (shade) {
      for (const other of WORLD_INDICATORS)
        if (other !== indicator) library.disable(worldFeedId(other));
      library.enable(worldFeedId(indicator));
    }
    summaryLine.textContent = `Loading ${indicator.name}…`;
    legend.replaceChildren();
    rankTop.replaceChildren();
    rankBottom.replaceChildren();
    try {
      const response = await doFetch(
        `/api/overlay-feed/${worldFeedId(indicator)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (destroyed || current !== indicator) return;
      rows = (body.features || [])
        .map((f) => f.properties)
        .filter((p) => Number.isFinite(p?.value));
      paintIndicator(indicator);
    } catch (error) {
      summaryLine.textContent = `${indicator.name}: unavailable (${error.message}).`;
    }
  }

  function paintIndicator(indicator) {
    const ramp = indicatorRamp(indicator);
    const values = rows.map((r) => r.value);
    const cuts = quantileBreaks(values, 6);
    const world = worldValue(indicator.code);
    const years = rows.map((r) => r.year).filter(Number.isFinite);
    summaryLine.textContent = `${indicator.name} · ${indicator.unit} · ${rows.length} countries · data years ${Math.min(...years)}–${Math.max(...years)}${world ? ` · world ${formatIndicator(world.value, indicator.format)} (${world.year})` : ''}`;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const bounds = [lo, ...cuts, hi];
    legend.replaceChildren(
      ...ramp.map((color, i) => {
        const item = el('div', 'ovl-legend-item');
        const dot = el('span', 'ovl-legend-dot');
        dot.style.setProperty('--ovl-color', color);
        const count = values.filter((v) => classOf(v, cuts) === i).length;
        item.append(
          dot,
          el(
            'span',
            '',
            `${formatIndicator(bounds[i], indicator.format)} – ${formatIndicator(bounds[i + 1], indicator.format)}  (${count})`,
          ),
        );
        return item;
      }),
    );
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    const top = Math.max(...values.map(Math.abs), 1);
    const bar = (r) => ({
      label: r.name,
      value: Math.abs(r.value),
      display: formatIndicator(r.value, indicator.format),
      swatch: ramp[r.q] ?? ramp[3],
      note: String(r.year ?? ''),
    });
    rankTop.replaceChildren(
      barList(sorted.slice(0, 10).map(bar), {
        max: top,
        ariaLabel: `Highest ${indicator.name}`,
      }),
    );
    rankBottom.replaceChildren(
      barList(sorted.slice(-10).reverse().map(bar), {
        max: top,
        ariaLabel: `Lowest ${indicator.name}`,
      }),
    );
    const selected = countrySelect.value;
    countrySelect.replaceChildren(el('option', '', 'Choose a country…'));
    countrySelect.firstChild.value = '';
    for (const r of [...rows].sort((a, b) => a.name.localeCompare(b.name))) {
      const option = el('option', '', r.name);
      option.value = r.iso3;
      countrySelect.appendChild(option);
    }
    countrySelect.value = selected || sheetIso || '';
  }

  async function showCountry(iso3) {
    sheetIso = iso3;
    countrySelect.value = iso3;
    sheet.replaceChildren(el('p', 'ovl-empty', 'Loading…'));
    try {
      const response = await doFetch(
        `/api/world-stats/country/${encodeURIComponent(iso3)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (destroyed || sheetIso !== iso3) return;
      paintSheet(data);
    } catch (error) {
      sheet.replaceChildren(
        el('p', 'ovl-empty', `Fact sheet unavailable (${error.message}).`),
      );
    }
  }

  function paintSheet(data) {
    const nodes = [];
    const head = el('div', 'ovl-world-sheet-head');
    if (data.wiki?.thumbnail) {
      const img = el('img', 'ovl-world-thumb');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = data.wiki.thumbnail;
      head.appendChild(img);
    }
    const title = el('div', 'ovl-world-sheet-title');
    title.append(
      el('strong', '', data.name),
      el(
        'span',
        'ovl-footnote',
        [data.capital && `Capital ${data.capital}`, data.region, data.income]
          .filter(Boolean)
          .join(' · '),
      ),
    );
    head.appendChild(title);
    nodes.push(head);
    if (data.wiki?.extract)
      nodes.push(el('p', 'ovl-world-extract', data.wiki.extract));
    const actions = el('div', 'ovl-actions');
    if (Number.isFinite(data.capitalLat) && Number.isFinite(data.capitalLon)) {
      const fly = el('button', 'ovl-mini-btn', 'FLY TO CAPITAL');
      fly.type = 'button';
      fly.addEventListener('click', () =>
        viewer?.camera?.flyTo?.({
          destination: Cesium.Cartesian3.fromDegrees(
            data.capitalLon,
            data.capitalLat,
            60_000,
          ),
          duration: 2.5,
        }),
      );
      actions.appendChild(fly);
    }
    if (/^https:\/\//.test(data.wiki?.link || '')) {
      const link = el('a', 'ovl-mini-btn', 'WIKIPEDIA ↗');
      link.href = data.wiki.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.appendChild(link);
    }
    if (actions.children.length) nodes.push(actions);
    for (const group of WORLD_GROUPS) {
      const entries = [];
      for (const indicator of WORLD_INDICATORS.filter(
        (i) => i.group === group.id,
      )) {
        const v = data.indicators?.[indicator.code];
        if (!v) continue;
        const w = worldValue(indicator.code);
        const ratio = w && w.value ? v.value / w.value : null;
        entries.push([
          `${indicator.name} (${v.year})`,
          `${indicatorText(v.value, indicator)}${ratio !== null && Number.isFinite(ratio) && indicator.format !== 'usdc' && indicator.code !== 'SP.POP.TOTL' ? `  · ${ratio >= 1 ? '▲' : '▼'} ${ratio.toFixed(ratio < 10 ? 1 : 0)}× world` : ''}`,
        ]);
      }
      if (entries.length) {
        nodes.push(el('div', 'ovl-world-subhead', group.name.toUpperCase()));
        nodes.push(factGrid(entries));
      }
    }
    sheet.replaceChildren(...nodes);
  }

  // Click a shaded country → fact sheet.
  removers.push(
    library.onPick(({ def, feature }) => {
      if (def?.category !== 'world') return;
      const iso3 = feature?.properties?.iso3;
      if (iso3) showCountry(iso3);
    }),
  );

  loadSummary();
  selectIndicator(current.slug, false);

  return {
    showCountry,
    setVisible(next) {
      visible = Boolean(next);
      clearInterval(clockTimer);
      clockTimer = 0;
      if (visible) {
        paintClock();
        clockTimer = setInterval(paintClock, 1000);
      }
    },
    destroy() {
      destroyed = true;
      clearInterval(clockTimer);
      for (const remove of removers.splice(0)) remove();
      container.replaceChildren();
    },
  };
}
