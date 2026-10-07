import { CATEGORY_BY_ID } from './categories.js';
import { formatValue } from './style.js';
import { maidenheadLocator } from './computedGeometry.js';
import { representativePoint } from './osmTiles.js';

/**
 * Floating info card for a clicked overlay feature. Values come from
 * third-party feeds, so everything is set with textContent and links are
 * restricted to http(s) and opened with noopener.
 */
export function createInfoCard({ host = document.body } = {}) {
  const card = document.createElement('div');
  card.className = 'ovl-info-card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Overlay feature details');
  host.appendChild(card);

  function close() {
    card.hidden = true;
    card.replaceChildren();
  }
  const onKey = (event) => {
    if (event.key === 'Escape' && !card.hidden) close();
  };
  document.addEventListener('keydown', onKey);

  function show({ def, feature, position }) {
    const props = feature.properties || {};
    const category = CATEGORY_BY_ID.get(def.category);
    card.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ovl-info-head';
    const kicker = document.createElement('div');
    kicker.className = 'ovl-info-kicker';
    kicker.textContent = `${category?.glyph || ''} ${def.name}`.trim();
    const title = document.createElement('div');
    title.className = 'ovl-info-title';
    const titleKey = def.info?.title;
    title.textContent = String(
      (titleKey && props[titleKey]) ||
        props.name ||
        props.title ||
        props.class ||
        def.name,
    ).slice(0, 140);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ovl-info-close';
    closeBtn.setAttribute('aria-label', 'Close details');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', close);
    head.append(kicker, closeBtn);
    card.append(head, title);

    const list = document.createElement('dl');
    list.className = 'ovl-info-fields';
    const links = [];
    for (const [label, key, format] of def.info?.fields || []) {
      if (format === 'image') {
        const src = String(props[key] || '');
        if (!/^https:\/\//i.test(src)) continue;
        const img = document.createElement('img');
        img.className = 'ovl-info-image';
        img.alt = label;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = src;
        img.addEventListener('error', () => img.remove(), { once: true });
        card.appendChild(img);
        continue;
      }
      const value = formatValue(props[key], format);
      if (value === null) continue;
      if (format === 'link') {
        links.push([label, value]);
        continue;
      }
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value.length > 400 ? `${value.slice(0, 399)}…` : value;
      list.append(dt, dd);
    }
    const point = representativePoint(feature.geometry);
    if (point) {
      const [lon, lat] = point;
      const dt = document.createElement('dt');
      dt.textContent = 'Location';
      const dd = document.createElement('dd');
      dd.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}° · ${maidenheadLocator(lat, lon)}`;
      list.append(dt, dd);
    }
    if (list.children.length) card.appendChild(list);
    if (links.length) {
      const row = document.createElement('div');
      row.className = 'ovl-info-links';
      for (const [label, href] of links) {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `${label} ↗`;
        row.appendChild(a);
      }
      card.appendChild(row);
    }
    const foot = document.createElement('div');
    foot.className = 'ovl-info-source';
    foot.textContent = `Source: ${def.source}`;
    card.appendChild(foot);

    card.hidden = false;
    const pad = 16;
    const w = card.offsetWidth || 300;
    const h = card.offsetHeight || 200;
    const x = Math.min(
      window.innerWidth - w - pad,
      Math.max(pad, (position?.x ?? window.innerWidth / 2) + 18),
    );
    const y = Math.min(
      window.innerHeight - h - pad,
      Math.max(pad, (position?.y ?? window.innerHeight / 2) - h / 2),
    );
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  return {
    show,
    close,
    destroy() {
      document.removeEventListener('keydown', onKey);
      card.remove();
    },
  };
}
