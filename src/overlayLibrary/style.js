/**
 * Pure styling and formatting helpers for the Overlay Library. Colors are
 * returned as `[r, g, b, a]` in 0..1 so the Cesium renderer can build its
 * colors without this module importing Cesium.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse #rgb / #rrggbb into [r, g, b, a] (0..1). Invalid input → white. */
export function parseHex(hex, alpha = 1) {
  const match = HEX.exec(String(hex || '').trim());
  if (!match) return [1, 1, 1, alpha];
  let h = match[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
    alpha,
  ];
}

/** Hex string from [r,g,b] 0..1. */
export function toHex([r, g, b]) {
  const c = (v) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Interpolate a color from numeric stops [[value, hex], …] (sorted ascending). */
export function colorFromStops(stops, value) {
  if (!Array.isArray(stops) || !stops.length) return null;
  if (!Number.isFinite(value)) return null;
  if (value <= stops[0][0]) return parseHex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const [v0, c0] = stops[i - 1];
      const t = v1 === v0 ? 1 : (value - v0) / (v1 - v0);
      const a = parseHex(c0);
      const b = parseHex(c1);
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), 1];
    }
  }
  return parseHex(stops[stops.length - 1][1]);
}

/** Resolve a feature's color [r,g,b,a] from an overlay style. */
export function featureColor(style = {}, properties = {}) {
  const base = parseHex(style.color || '#00d4ff');
  const rule = style.colorBy;
  if (!rule?.prop) return base;
  const value = properties?.[rule.prop];
  if (value === null || value === undefined) return base;
  if (rule.direct) {
    return HEX.test(String(value)) ? parseHex(String(value)) : base;
  }
  if (rule.map) {
    const hit = rule.map[value] ?? rule.map[String(value)];
    return hit ? parseHex(hit) : base;
  }
  if (rule.stops) {
    return colorFromStops(rule.stops, Number(value)) || base;
  }
  return base;
}

/** Resolve a point's pixel size from an overlay style. */
export function featureSize(style = {}, properties = {}) {
  const fallback = Number(style.size) || 7;
  const rule = style.sizeBy;
  if (!rule?.prop) return fallback;
  const raw = Number(properties?.[rule.prop]);
  if (!Number.isFinite(raw))
    return Math.max(3, (rule.range?.[0] ?? fallback) - 1);
  const [d0, d1] = rule.domain || [0, 1];
  const [r0, r1] = rule.range || [4, 16];
  const scale =
    rule.scale === 'sqrt' ? (v) => Math.sqrt(Math.max(0, v)) : (v) => v;
  const lo = scale(d0);
  const hi = scale(d1);
  const t =
    hi === lo ? 1 : (scale(Math.min(Math.max(raw, d0), d1)) - lo) / (hi - lo);
  return Math.round(lerp(r0, r1, Math.max(0, Math.min(1, t))) * 10) / 10;
}

/** Priority used to pick which features get labels first. */
export function featurePriority(style = {}, properties = {}) {
  const prop = style.sizeBy?.prop;
  const v = prop ? Number(properties?.[prop]) : NaN;
  return Number.isFinite(v) ? v : 0;
}

const NUMBER = new Intl.NumberFormat('en-US');

/** Format one info-card value. Returns null when there is nothing to show. */
export function formatValue(value, format = 'text') {
  if (value === null || value === undefined || value === '') return null;
  const [kind, arg] = String(format).split(':');
  const num = Number(value);
  switch (kind) {
    case 'int':
      return Number.isFinite(num)
        ? NUMBER.format(Math.round(num))
        : String(value);
    case 'num':
      return Number.isFinite(num)
        ? num.toLocaleString('en-US', {
            minimumFractionDigits: Number(arg) || 0,
            maximumFractionDigits: Number(arg) || 0,
          })
        : String(value);
    case 'mw':
      return Number.isFinite(num)
        ? `${NUMBER.format(Math.round(num * 10) / 10)} MW`
        : null;
    case 'm':
      return Number.isFinite(num)
        ? `${NUMBER.format(Math.round(num))} m`
        : null;
    case 'ft':
      return Number.isFinite(num)
        ? `${NUMBER.format(Math.round(num))} ft`
        : null;
    case 'km':
      return Number.isFinite(num)
        ? `${NUMBER.format(Math.round(num))} km`
        : null;
    case 'pct':
      return Number.isFinite(num) ? `${Math.round(num)}%` : null;
    case 'time': {
      const date =
        typeof value === 'number' || /^\d{10,13}$/.test(String(value))
          ? new Date(
              Number(value) < 1e11 ? Number(value) * 1000 : Number(value),
            )
          : new Date(
              /Z|[+-]\d\d:?\d\d$/.test(String(value)) ||
                !/T\d/.test(String(value))
                ? String(value)
                : `${value}Z`,
            );
      if (Number.isNaN(date.getTime())) return String(value);
      return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
    }
    case 'link':
      return /^https?:\/\//i.test(String(value)) ? String(value) : null;
    default:
      return String(value);
  }
}

/** Human-readable byte size. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Compact count: 950, 12.4K, 3.1M. */
export function formatCount(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 1000) return String(Math.round(n));
  if (Math.abs(n) < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  if (Math.abs(n) < 1e9) return `${(n / 1e6).toFixed(1)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}

/** "3m ago" style relative time. */
export function formatAge(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
