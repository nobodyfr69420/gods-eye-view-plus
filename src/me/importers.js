/**
 * ME — import your own location history from files. Pure parsers (string or
 * ArrayBuffer in, fixes out), no DOM, so they run in tests and workers.
 *
 * Supported: GPX (tracks, routes, waypoints), KML (incl. gx:Track), GeoJSON
 * (points, lines, coordTimes), CSV (lat/lon/time columns), Google Takeout /
 * Timeline (legacy Records.json, Semantic Location History, and the 2024+
 * on-device Timeline export from Android and iOS), and photo EXIF GPS.
 */
import { readExifGps } from './exif.js';

const MAX_FIXES = 2_000_000;

const fix = (lat, lon, t, extra = {}) => {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0))
    return null;
  const time = typeof t === 'number' ? t : Date.parse(String(t ?? ''));
  return {
    lat: la,
    lon: lo,
    t: Number.isFinite(time) ? (time < 1e11 ? time * 1000 : time) : null,
    ...extra,
  };
};

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return m ? m[1] : null;
};
const inner = (xml, name) => {
  const m = new RegExp(
    `<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
    'i',
  ).exec(xml);
  return m ? m[1].trim() : null;
};

/** GPX trkpt / rtept / wpt. */
export function parseGpx(text) {
  const out = [];
  const re =
    /<(trkpt|rtept|wpt)\b([^>]*)>([\s\S]*?)<\/\1>|<(trkpt|rtept|wpt)\b([^>]*)\/>/gi;
  let m;
  while ((m = re.exec(text)) && out.length < MAX_FIXES) {
    const tag = m[2] ?? m[5] ?? '';
    const body = m[3] ?? '';
    const ele = Number(inner(body, 'ele'));
    const f = fix(
      attr(tag, 'lat'),
      attr(tag, 'lon'),
      inner(body, 'time'),
      Number.isFinite(ele) ? { alt: ele } : {},
    );
    if (f) out.push(f);
  }
  return out;
}

/** KML coordinates and gx:Track when/coord pairs. */
export function parseKml(text) {
  const out = [];
  const trackRe = /<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track>/gi;
  let m;
  let sawTrack = false;
  while ((m = trackRe.exec(text))) {
    sawTrack = true;
    const whens = [...m[1].matchAll(/<when>([^<]+)<\/when>/gi)].map(
      (x) => x[1],
    );
    const coords = [...m[1].matchAll(/<gx:coord>([^<]+)<\/gx:coord>/gi)].map(
      (x) => x[1].trim().split(/\s+/),
    );
    coords.forEach(([lon, lat, alt], i) => {
      const f = fix(
        lat,
        lon,
        whens[i],
        Number.isFinite(Number(alt)) ? { alt: Number(alt) } : {},
      );
      if (f) out.push(f);
    });
  }
  if (sawTrack) return out;
  const placemarks = text.split(/<Placemark\b/i).slice(1);
  const blocks = placemarks.length ? placemarks : [text];
  for (const block of blocks) {
    const when = inner(block, 'when') || inner(block, 'begin');
    const coordRe = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
    let c;
    while ((c = coordRe.exec(block)) && out.length < MAX_FIXES) {
      for (const tuple of c[1].trim().split(/\s+/)) {
        const [lon, lat, alt] = tuple.split(',');
        const f = fix(
          lat,
          lon,
          when,
          Number.isFinite(Number(alt)) && Number(alt) !== 0
            ? { alt: Number(alt) }
            : {},
        );
        if (f) out.push(f);
      }
    }
  }
  return out;
}

/** GeoJSON Point / LineString / Multi*, with time in properties or coordTimes. */
export function parseGeojson(json) {
  const out = [];
  const features =
    json?.type === 'FeatureCollection'
      ? json.features || []
      : json?.type === 'Feature'
        ? [json]
        : json?.type
          ? [{ type: 'Feature', geometry: json, properties: {} }]
          : [];
  for (const feature of features) {
    const g = feature?.geometry;
    const p = feature?.properties || {};
    const time = p.time ?? p.timestamp ?? p.datetime ?? p.date ?? null;
    const times = p.coordTimes || p.times || null;
    const push = ([lon, lat, alt], i) => {
      const t = Array.isArray(times) ? times[i] : time;
      const f = fix(lat, lon, t, Number.isFinite(alt) ? { alt } : {});
      if (f) out.push(f);
    };
    if (!g) continue;
    if (g.type === 'Point') push(g.coordinates, 0);
    else if (g.type === 'MultiPoint' || g.type === 'LineString')
      g.coordinates.forEach(push);
    else if (g.type === 'MultiLineString') g.coordinates.flat().forEach(push);
  }
  return out;
}

/** CSV with recognizable latitude / longitude / time headers. */
export function parseCsvTrack(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep =
    lines[0].includes(';') && !lines[0].includes(',')
      ? ';'
      : lines[0].includes('\t')
        ? '\t'
        : ',';
  const head = lines[0]
    .split(sep)
    .map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const find = (...names) => head.findIndex((h) => names.includes(h));
  const iLat = find('lat', 'latitude', 'y');
  const iLon = find('lon', 'lng', 'long', 'longitude', 'x');
  const iTime = find(
    'time',
    'timestamp',
    'datetime',
    'date',
    'date_time',
    'utc',
    'recorded_at',
  );
  const iAlt = find('alt', 'altitude', 'ele', 'elevation');
  const iAcc = find('acc', 'accuracy', 'hacc', 'horizontal_accuracy');
  if (iLat < 0 || iLon < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const extra = {};
    if (iAlt >= 0 && Number.isFinite(Number(cells[iAlt])))
      extra.alt = Number(cells[iAlt]);
    if (iAcc >= 0 && Number.isFinite(Number(cells[iAcc])))
      extra.acc = Number(cells[iAcc]);
    const f = fix(
      cells[iLat],
      cells[iLon],
      iTime >= 0 ? cells[iTime] : null,
      extra,
    );
    if (f) out.push(f);
    if (out.length >= MAX_FIXES) break;
  }
  return out;
}

/** "47.1234567°, 8.1234567°" or "geo:47.1,8.1" → [lat, lon]. */
export function parseLatLngText(value) {
  const m = /(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?/.exec(
    String(value ?? '').replace(/^geo:/, ''),
  );
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const e7 = (v) => Number(v) / 1e7;

/** Every Google location-history shape we know of. */
export function parseGoogleTimeline(json) {
  const out = [];
  const push = (f) => {
    if (f && out.length < MAX_FIXES) out.push(f);
  };
  // Legacy Records.json
  if (Array.isArray(json?.locations)) {
    for (const r of json.locations) {
      push(
        fix(
          e7(r.latitudeE7),
          e7(r.longitudeE7),
          r.timestamp ?? Number(r.timestampMs),
          {
            ...(Number.isFinite(r.accuracy) ? { acc: r.accuracy } : {}),
            ...(Number.isFinite(r.altitude) ? { alt: r.altitude } : {}),
            ...(Number.isFinite(r.velocity) ? { spd: r.velocity } : {}),
            ...(Number.isFinite(r.heading) ? { hdg: r.heading } : {}),
          },
        ),
      );
    }
    return out;
  }
  // Semantic Location History (YYYY_MONTH.json)
  if (Array.isArray(json?.timelineObjects)) {
    for (const o of json.timelineObjects) {
      const visit = o.placeVisit;
      if (visit?.location) {
        push(
          fix(
            e7(visit.location.latitudeE7),
            e7(visit.location.longitudeE7),
            visit.duration?.startTimestamp,
            { place: visit.location.name || visit.location.address || null },
          ),
        );
        push(
          fix(
            e7(visit.location.latitudeE7),
            e7(visit.location.longitudeE7),
            visit.duration?.endTimestamp,
          ),
        );
      }
      const seg = o.activitySegment;
      if (seg) {
        push(
          fix(
            e7(seg.startLocation?.latitudeE7),
            e7(seg.startLocation?.longitudeE7),
            seg.duration?.startTimestamp,
          ),
        );
        for (const p of seg.simplifiedRawPath?.points || [])
          push(fix(e7(p.latE7), e7(p.lngE7), p.timestamp));
        push(
          fix(
            e7(seg.endLocation?.latitudeE7),
            e7(seg.endLocation?.longitudeE7),
            seg.duration?.endTimestamp,
          ),
        );
      }
    }
    return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  }
  // 2024+ on-device export (Android "Timeline.json") or the iOS array form
  const segmentsList = Array.isArray(json?.semanticSegments)
    ? json.semanticSegments
    : Array.isArray(json)
      ? json
      : null;
  if (segmentsList) {
    for (const s of segmentsList) {
      const start = Date.parse(s.startTime);
      for (const p of s.timelinePath || []) {
        const ll = parseLatLngText(p.point);
        const t =
          p.time ??
          (Number.isFinite(start) &&
          p.durationMinutesOffsetFromStartTime !== undefined
            ? start + Number(p.durationMinutesOffsetFromStartTime) * 60_000
            : null);
        if (ll) push(fix(ll[0], ll[1], t));
      }
      const placeLL = parseLatLngText(
        s.visit?.topCandidate?.placeLocation?.latLng ??
          s.visit?.topCandidate?.placeLocation,
      );
      if (placeLL) {
        push(
          fix(placeLL[0], placeLL[1], s.startTime, {
            place: s.visit?.topCandidate?.semanticType || null,
          }),
        );
        push(fix(placeLL[0], placeLL[1], s.endTime));
      }
      const a = parseLatLngText(s.activity?.start?.latLng ?? s.activity?.start);
      const b = parseLatLngText(s.activity?.end?.latLng ?? s.activity?.end);
      if (a) push(fix(a[0], a[1], s.startTime));
      if (b) push(fix(b[0], b[1], s.endTime));
    }
    for (const r of json?.rawSignals || []) {
      const p = r.position;
      const ll = parseLatLngText(p?.LatLng ?? p?.latLng);
      if (ll)
        push(
          fix(ll[0], ll[1], p.timestamp, {
            ...(Number.isFinite(p.accuracyMeters)
              ? { acc: p.accuracyMeters }
              : {}),
            ...(Number.isFinite(p.altitudeMeters)
              ? { alt: p.altitudeMeters }
              : {}),
            ...(Number.isFinite(p.speedMetersPerSecond)
              ? { spd: p.speedMetersPerSecond }
              : {}),
          }),
        );
    }
    return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  }
  return out;
}

/**
 * Detect and parse one file. `name` picks the format when the extension is
 * clear; JSON content is sniffed (Takeout vs GeoJSON).
 * @returns {{format: string, fixes: object[]}}
 */
export function parseLocationFile(name, content) {
  const lower = String(name || '').toLowerCase();
  if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
    const buffer = content instanceof ArrayBuffer ? content : content.buffer;
    const gps = readExifGps(buffer);
    return { format: 'photo', fixes: gps ? [{ ...gps, photo: name }] : [] };
  }
  const text = String(content ?? '');
  if (lower.endsWith('.gpx') || /<gpx\b/i.test(text.slice(0, 2000)))
    return { format: 'gpx', fixes: parseGpx(text) };
  if (lower.endsWith('.kml') || /<kml\b/i.test(text.slice(0, 2000)))
    return { format: 'kml', fixes: parseKml(text) };
  if (lower.endsWith('.csv') || lower.endsWith('.tsv'))
    return { format: 'csv', fixes: parseCsvTrack(text) };
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { format: 'unknown', fixes: parseCsvTrack(text) };
  }
  if (
    json?.type &&
    (json.type === 'FeatureCollection' ||
      json.type === 'Feature' ||
      json.coordinates)
  )
    return { format: 'geojson', fixes: parseGeojson(json) };
  return { format: 'google-timeline', fixes: parseGoogleTimeline(json) };
}
