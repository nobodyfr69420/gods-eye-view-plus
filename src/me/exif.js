/**
 * Minimal JPEG EXIF reader: just the GPS position, altitude and capture time
 * of your own photos, so they can be placed on the globe. Pure (ArrayBuffer
 * in), bounds-checked everywhere; anything unexpected returns null.
 */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readIfd(view, tiff, offset, little) {
  const entries = new Map();
  if (offset + 2 > view.byteLength) return entries;
  const count = view.getUint16(offset, little);
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (at + 12 > view.byteLength) break;
    const tag = view.getUint16(at, little);
    const type = view.getUint16(at + 2, little);
    const n = view.getUint32(at + 4, little);
    const size = (TYPE_SIZE[type] || 1) * n;
    const valueAt = size <= 4 ? at + 8 : tiff + view.getUint32(at + 8, little);
    if (valueAt + size > view.byteLength) continue;
    entries.set(tag, { type, n, valueAt });
  }
  return entries;
}

function rationals(view, entry, little) {
  const out = [];
  for (let i = 0; i < entry.n; i++) {
    const num = view.getUint32(entry.valueAt + i * 8, little);
    const den = view.getUint32(entry.valueAt + i * 8 + 4, little);
    out.push(den ? num / den : 0);
  }
  return out;
}

function ascii(view, entry) {
  let s = '';
  for (let i = 0; i < entry.n; i++) {
    const c = view.getUint8(entry.valueAt + i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** @returns {{lat:number, lon:number, alt?:number, t:number|null} | null} */
export function readExifGps(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      const length = view.getUint16(offset + 2);
      if (
        marker === 0xffe1 &&
        offset + 10 <= view.byteLength &&
        view.getUint32(offset + 4) === 0x45786966
      ) {
        const tiff = offset + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const ifd0 = readIfd(
          view,
          tiff,
          tiff + view.getUint32(tiff + 4, little),
          little,
        );
        const gpsPtr = ifd0.get(0x8825);
        if (!gpsPtr) return null;
        const gps = readIfd(
          view,
          tiff,
          tiff + view.getUint32(gpsPtr.valueAt, little),
          little,
        );
        const latRef = gps.get(1);
        const lat = gps.get(2);
        const lonRef = gps.get(3);
        const lon = gps.get(4);
        if (!lat || !lon) return null;
        const dms = (e) => {
          const [d, m, s] = rationals(view, e, little);
          return d + m / 60 + s / 3600;
        };
        let la = dms(lat);
        let lo = dms(lon);
        if (latRef && ascii(view, latRef) === 'S') la = -la;
        if (lonRef && ascii(view, lonRef) === 'W') lo = -lo;
        if (
          !Number.isFinite(la) ||
          !Number.isFinite(lo) ||
          (la === 0 && lo === 0)
        )
          return null;
        const out = { lat: la, lon: lo, t: null };
        const alt = gps.get(6);
        if (alt) {
          const [a] = rationals(view, alt, little);
          const below = gps.get(5) && view.getUint8(gps.get(5).valueAt) === 1;
          out.alt = below ? -a : a;
        }
        const date = gps.get(29);
        const time = gps.get(7);
        if (date && time) {
          const [h, mi, s] = rationals(view, time, little);
          const d = ascii(view, date).replace(/:/g, '-');
          const t = Date.parse(
            `${d}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}Z`,
          );
          if (Number.isFinite(t)) out.t = t;
        }
        if (out.t === null) {
          const exifPtr = ifd0.get(0x8769);
          if (exifPtr) {
            const exif = readIfd(
              view,
              tiff,
              tiff + view.getUint32(exifPtr.valueAt, little),
              little,
            );
            const original = exif.get(0x9003);
            if (original) {
              const [d, tm] = ascii(view, original).split(' ');
              const t = Date.parse(`${d.replace(/:/g, '-')}T${tm}`); // camera local time
              if (Number.isFinite(t)) out.t = t;
            }
          }
        }
        return out;
      }
      if ((marker & 0xff00) !== 0xff00 || length < 2) return null;
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}
