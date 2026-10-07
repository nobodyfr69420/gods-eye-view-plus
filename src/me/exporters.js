/** ME — export your fixes as GPX, GeoJSON or CSV (pure string builders). */
import { byDevice, segments } from './trackMath.js';

const esc = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c],
  );
const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : '');

export function toGpx(fixes, { name = "God's Eye View — ME" } = {}) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="gods-eye-view" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${esc(name)}</name><time>${iso(Date.now())}</time></metadata>`,
  ];
  for (const [device, list] of byDevice(fixes)) {
    parts.push(`<trk><name>${esc(device)}</name>`);
    for (const seg of segments(list).length ? segments(list) : [list]) {
      parts.push('<trkseg>');
      for (const f of seg)
        parts.push(
          `<trkpt lat="${f.lat}" lon="${f.lon}">${Number.isFinite(f.alt) ? `<ele>${f.alt}</ele>` : ''}${f.t ? `<time>${iso(f.t)}</time>` : ''}</trkpt>`,
        );
      parts.push('</trkseg>');
    }
    parts.push('</trk>');
  }
  parts.push('</gpx>');
  return parts.join('\n');
}

export function toGeojson(fixes) {
  const features = [];
  for (const [device, list] of byDevice(fixes)) {
    for (const seg of segments(list)) {
      features.push({
        type: 'Feature',
        properties: {
          device,
          start: iso(seg[0].t),
          end: iso(seg[seg.length - 1].t),
          coordTimes: seg.map((f) => iso(f.t)),
        },
        geometry: {
          type: 'LineString',
          coordinates: seg.map((f) =>
            Number.isFinite(f.alt) ? [f.lon, f.lat, f.alt] : [f.lon, f.lat],
          ),
        },
      });
    }
  }
  return JSON.stringify({ type: 'FeatureCollection', features });
}

export function toCsv(fixes) {
  const rows = [
    'device,time,latitude,longitude,altitude_m,accuracy_m,speed_ms,heading_deg,battery_pct,source',
  ];
  for (const f of fixes)
    rows.push(
      [
        f.device,
        iso(f.t),
        f.lat,
        f.lon,
        f.alt ?? '',
        f.acc ?? '',
        f.spd ?? '',
        f.hdg ?? '',
        f.batt ?? '',
        f.src ?? '',
      ]
        .map((v) =>
          /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v,
        )
        .join(','),
    );
  return rows.join('\n');
}
