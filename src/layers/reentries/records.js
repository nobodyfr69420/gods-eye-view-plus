/**
 * @module reentries/records
 * @description Pure parsers for upcoming re-entries.
 *
 * Two sources with different authority, never mixed in one list:
 * - OFFICIAL: US Space Force Tracking and Impact Prediction (TIP) messages
 *   from Space-Track.org (free account; credentials stay server-side).
 * - ESTIMATED: a keyless "decay watch" — objects whose CelesTrak TLE puts the
 *   perigee below ~200 km. That is a physical indicator of imminent decay, not
 *   a re-entry time, and it is labelled as such.
 */
import { parseTleText } from '../../sources/tle.js';
import { tleOrbitSummary } from '../satelliteGroups/model.js';

export const SPACE_TRACK_ORIGIN = 'https://www.space-track.org';
export const SPACE_TRACK_LOGIN_URL = `${SPACE_TRACK_ORIGIN}/ajaxauth/login`;
/** TIP messages issued in the last 10 days, newest first. */
export const SPACE_TRACK_TIP_QUERY = `${SPACE_TRACK_ORIGIN}/basicspacedata/query/class/tip/MSG_EPOCH/%3Enow-10/orderby/MSG_EPOCH%20desc/limit/1000/format/json`;
/** Catalog names for a comma-separated NORAD list. */
export function spaceTrackSatcatQuery(norads) {
  return `${SPACE_TRACK_ORIGIN}/basicspacedata/query/class/satcat/NORAD_CAT_ID/${norads.join(',')}/format/json`;
}

/** CelesTrak groups the keyless decay watch scans. */
export const DECAY_WATCH_GROUPS = Object.freeze([
  'last-30-days',
  'stations',
  'starlink',
  'cubesat',
  'cosmos-1408-debris',
  'fengyun-1c-debris',
  'iridium-33-debris',
  'cosmos-2251-debris',
]);
/** Perigee below which an object is listed on the decay watch, km. */
export const DECAY_WATCH_PERIGEE_KM = 200;
/** Keep TIP predictions whose decay epoch is at most this far in the past. */
const RECENT_DECAY_MS = 24 * 3_600_000;
const MAX_TIPS = 60;
const MAX_WATCH = 80;

function text(value, max = 48) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  // eslint-disable-next-line no-control-regex
  const clean = String(value)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim();
  return clean ? clean.slice(0, max) : null;
}

/** Space-Track epoch (`2026-10-07 03:00:00`, UTC) → ms. */
export function parseSpaceTrackTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d(?:\.\d+)?)?)Z?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const ms = Date.parse(`${match[1]}T${match[2]}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function finite(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/**
 * Latest TIP prediction per object, upcoming or decayed within 24 h.
 * @param {unknown} payload Space-Track `class/tip` JSON.
 * @param {number} nowMs
 * @returns {Array<{norad:number, decayAt:number, windowMin:number|null, messageAt:number|null, latitude:number|null, longitude:number|null, direction:string|null, inclinationDeg:number|null, highInterest:boolean}>|null}
 */
export function parseTipMessages(payload, nowMs = Date.now()) {
  if (!Array.isArray(payload)) return null;
  const latest = new Map();
  for (const row of payload) {
    if (!row || typeof row !== 'object') continue;
    const norad = finite(row.NORAD_CAT_ID ?? row.OBJECT_NUMBER, 1, 999_999_999);
    const decayAt = parseSpaceTrackTime(row.DECAY_EPOCH);
    if (!Number.isInteger(norad) || decayAt === null) continue;
    const messageAt =
      parseSpaceTrackTime(row.MSG_EPOCH) ??
      parseSpaceTrackTime(row.INSERT_EPOCH);
    const previous = latest.get(norad);
    if (previous && (previous.messageAt ?? 0) >= (messageAt ?? 0)) continue;
    latest.set(norad, {
      norad,
      decayAt,
      windowMin: finite(row.WINDOW, 0, 100_000),
      messageAt,
      latitude: finite(row.LAT, -90, 90),
      longitude: finite(row.LON, -180, 360),
      direction: text(row.DIRECTION, 16),
      inclinationDeg: finite(row.INCL, 0, 180),
      highInterest: String(row.HIGH_INTEREST).toUpperCase() === 'Y',
    });
  }
  return [...latest.values()]
    .map((tip) =>
      tip.longitude !== null && tip.longitude > 180
        ? { ...tip, longitude: tip.longitude - 360 }
        : tip,
    )
    .filter((tip) => tip.decayAt >= nowMs - RECENT_DECAY_MS)
    .sort((a, b) => a.decayAt - b.decayAt || a.norad - b.norad)
    .slice(0, MAX_TIPS);
}

/**
 * Names from a Space-Track `class/satcat` response.
 * @param {unknown} payload
 * @returns {Map<number, {name:string|null, objectType:string|null, country:string|null}>}
 */
export function parseSatcatNames(payload) {
  const names = new Map();
  if (!Array.isArray(payload)) return names;
  for (const row of payload) {
    const norad = finite(row?.NORAD_CAT_ID, 1, 999_999_999);
    if (!Number.isInteger(norad)) continue;
    names.set(norad, {
      name: text(row.OBJECT_NAME ?? row.SATNAME),
      objectType: text(row.OBJECT_TYPE, 16),
      country: text(row.COUNTRY, 8),
    });
  }
  return names;
}

/**
 * Keyless decay watch from CelesTrak TLE text.
 * @param {Map<string,string>|Record<string,string>} groupTexts group → TLE text.
 * @param {number} nowMs
 * @returns {Array<{norad:number, name:string, line1:string, line2:string, perigeeKm:number, apogeeKm:number, epochMs:number|null, group:string, summary:object}>}
 */
export function decayWatchCandidates(groupTexts, nowMs = Date.now()) {
  const texts =
    groupTexts instanceof Map
      ? groupTexts
      : new Map(Object.entries(groupTexts));
  const seen = new Set();
  const out = [];
  for (const group of DECAY_WATCH_GROUPS) {
    const body = texts.get(group);
    if (typeof body !== 'string') continue;
    for (const tle of parseTleText(body)) {
      const summary = tleOrbitSummary(tle.line1, tle.line2);
      if (!summary || seen.has(summary.norad)) continue;
      seen.add(summary.norad);
      if (!(summary.perigeeKm < DECAY_WATCH_PERIGEE_KM)) continue;
      // A TLE more than 30 days old for a sub-200 km object almost certainly
      // describes something that has already re-entered.
      if (
        Number.isFinite(summary.epochMs) &&
        nowMs - summary.epochMs > 30 * 86_400_000
      )
        continue;
      out.push({
        norad: summary.norad,
        name: tle.name.replace(/^0 /, '').trim().slice(0, 64),
        line1: tle.line1,
        line2: tle.line2,
        perigeeKm: summary.perigeeKm,
        apogeeKm: summary.apogeeKm,
        epochMs: summary.epochMs,
        group,
        summary,
        category: 'reentry',
      });
    }
  }
  return out.sort((a, b) => a.perigeeKm - b.perigeeKm).slice(0, MAX_WATCH);
}

/**
 * Validate the provider's TIP snapshot in the browser.
 * @param {unknown} value `/api/space/reentries` body.
 */
export function validateReentrySnapshot(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
    throw new Error('Malformed re-entry snapshot');
  const tips = Array.isArray(value.tips)
    ? value.tips.slice(0, MAX_TIPS).flatMap((tip) => {
        if (!Number.isInteger(tip?.norad) || !Number.isFinite(tip?.decayAt))
          return [];
        const num = (v, min, max) =>
          Number.isFinite(v) && v >= min && v <= max ? v : null;
        return [
          {
            norad: tip.norad,
            decayAt: tip.decayAt,
            windowMin: num(tip.windowMin, 0, 100_000),
            messageAt: num(tip.messageAt, 0, 1e15),
            latitude: num(tip.latitude, -90, 90),
            longitude: num(tip.longitude, -180, 180),
            direction: text(tip.direction, 16),
            inclinationDeg: num(tip.inclinationDeg, 0, 180),
            highInterest: tip.highInterest === true,
            name: text(tip.name, 64),
            objectType: text(tip.objectType, 16),
            country: text(tip.country, 8),
          },
        ];
      })
    : [];
  return {
    schemaVersion: 1,
    configured: value.configured === true,
    source: 'Space-Track.org TIP',
    fetchedAt: Number.isFinite(value.fetchedAt) ? value.fetchedAt : null,
    stale: value.stale === true,
    unavailable: value.unavailable === true,
    reason: text(value.reason, 120),
    tips,
  };
}
