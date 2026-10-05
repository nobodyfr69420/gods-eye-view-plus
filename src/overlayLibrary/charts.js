/**
 * Tiny dependency-free chart pieces for the STATS tab, built with DOM/SVG
 * APIs (labels via textContent). Single-series marks use the app accent;
 * text always wears text tokens, never the data color. Every value a hover
 * shows is also printed beside its mark, so nothing is tooltip-gated.
 */

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** A labeled stat tile. */
export function statTile(label, value, sub) {
  const tile = el('div', 'ovl-tile');
  tile.append(
    el('div', 'ovl-tile-label', label),
    el('div', 'ovl-tile-value', value),
  );
  if (sub) tile.appendChild(el('div', 'ovl-tile-sub', sub));
  return tile;
}

/**
 * Horizontal bar list. rows: [{label, value, display, swatch?, note?}]
 * Bars grow from one baseline; the value is printed at the bar's tip column.
 */
export function barList(
  rows,
  { emptyText = 'Nothing to show yet', max = null, ariaLabel = '' } = {},
) {
  const wrap = el('div', 'ovl-bars');
  if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
  wrap.setAttribute('role', 'list');
  if (!rows.length) {
    wrap.appendChild(el('p', 'ovl-empty', emptyText));
    return wrap;
  }
  const top = max ?? Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  for (const r of rows) {
    const row = el('div', 'ovl-bar-row');
    row.setAttribute('role', 'listitem');
    const label = el('div', 'ovl-bar-label');
    if (r.swatch) {
      const dot = el('span', 'ovl-swatch ovl-swatch-sm');
      dot.style.setProperty('--ovl-color', r.swatch);
      dot.setAttribute('aria-hidden', 'true');
      label.appendChild(dot);
    }
    label.appendChild(el('span', 'ovl-bar-name', r.label));
    if (r.note) label.appendChild(el('span', 'ovl-bar-note', r.note));
    const track = el('div', 'ovl-bar-track');
    const fill = el('div', 'ovl-bar-fill');
    const pct =
      top > 0
        ? Math.max(0, Math.min(100, ((Number(r.value) || 0) / top) * 100))
        : 0;
    fill.style.width = `${pct > 0 ? Math.max(pct, 1.5) : 0}%`;
    track.appendChild(fill);
    const value = el('div', 'ovl-bar-value', r.display ?? String(r.value));
    row.title = `${r.label}: ${r.display ?? r.value}`;
    row.append(label, track, value);
    wrap.appendChild(row);
  }
  return wrap;
}

/**
 * Sparkline with an area wash, end dot and a hover crosshair readout.
 * points: [{t, v}] oldest → newest.
 */
export function sparkline(
  points,
  { width = 280, height = 54, format = (v) => String(v), label = '' } = {},
) {
  const wrap = el('div', 'ovl-spark');
  const head = el('div', 'ovl-spark-head');
  const current = points.length ? points[points.length - 1].v : null;
  head.append(
    el('span', 'ovl-spark-label', label),
    el('span', 'ovl-spark-value', current === null ? '—' : format(current)),
  );
  wrap.appendChild(head);
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'ovl-spark-svg',
    role: 'img',
  });
  chart.setAttribute(
    'aria-label',
    `${label}: ${current === null ? 'no data' : format(current)}`,
  );
  wrap.appendChild(chart);
  if (points.length < 2) return wrap;
  const values = points.map((p) => p.v);
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values, lo + 1);
  const pad = 4;
  const x = (i) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2);
  chart.appendChild(
    svg('line', {
      x1: pad,
      x2: width - pad,
      y1: height - pad,
      y2: height - pad,
      class: 'ovl-spark-base',
    }),
  );
  const line = points
    .map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
  chart.appendChild(
    svg('polygon', {
      points: `${x(0)},${height - pad} ${line} ${x(points.length - 1)},${height - pad}`,
      class: 'ovl-spark-area',
    }),
  );
  chart.appendChild(svg('polyline', { points: line, class: 'ovl-spark-line' }));
  chart.appendChild(
    svg('circle', {
      cx: x(points.length - 1),
      cy: y(current),
      r: 3.5,
      class: 'ovl-spark-dot',
    }),
  );
  const cross = svg('line', {
    y1: pad,
    y2: height - pad,
    class: 'ovl-spark-cross',
    visibility: 'hidden',
  });
  const hoverDot = svg('circle', {
    r: 3.5,
    class: 'ovl-spark-dot',
    visibility: 'hidden',
  });
  chart.append(cross, hoverDot);
  const tip = el('div', 'ovl-tooltip');
  tip.hidden = true;
  wrap.appendChild(tip);
  const hit = svg('rect', { x: 0, y: 0, width, height, fill: 'transparent' });
  chart.appendChild(hit);
  const move = (event) => {
    const rect = chart.getBoundingClientRect();
    const rx = ((event.clientX - rect.left) / rect.width) * width;
    const i = Math.max(
      0,
      Math.min(
        points.length - 1,
        Math.round(((rx - pad) / (width - pad * 2)) * (points.length - 1)),
      ),
    );
    const p = points[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', x(i));
    hoverDot.setAttribute('cy', y(p.v));
    hoverDot.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      el('strong', '', format(p.v)),
      el('span', '', ` · ${Math.round((Date.now() - p.t) / 1000)} s ago`),
    );
    tip.hidden = false;
    tip.style.left = `${Math.min(rect.width - 90, Math.max(0, (x(i) / width) * rect.width - 40))}px`;
  };
  const leave = () => {
    cross.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
  return wrap;
}

/** Column chart with per-column status coloring (used for Kp). */
export function columnStrip(values, { height = 46, colorFor, titleFor, max }) {
  const wrap = el('div', 'ovl-columns');
  wrap.style.height = `${height}px`;
  const top = max ?? Math.max(...values.map((v) => v.value), 1);
  for (const v of values) {
    const col = el('div', 'ovl-column');
    col.style.height = `${Math.max(2, (v.value / top) * 100)}%`;
    col.style.setProperty('--ovl-color', colorFor(v));
    col.title = titleFor(v);
    wrap.appendChild(col);
  }
  return wrap;
}

/** Key/value fact grid. */
export function factGrid(entries) {
  const grid = el('dl', 'ovl-factgrid');
  for (const [label, value] of entries) {
    if (value === null || value === undefined || value === '') continue;
    grid.append(el('dt', '', label), el('dd', '', String(value)));
  }
  return grid;
}

export { el };
