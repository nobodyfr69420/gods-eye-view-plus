import { parseTleText } from '../../sources/tle.js';
import { SATELLITE_GROUP_CATEGORIES, tleOrbitSummary } from './model.js';

/** Hard ceiling on catalog size; the full public catalog is ~30k objects. */
export const MAX_GROUP_RECORDS = 40_000;

/**
 * Merge fetched CelesTrak groups into one deduplicated record list.
 *
 * A satellite present in several categories keeps the first category in table
 * order. Records whose TLE does not parse are skipped, never guessed.
 * @param {Map<string, string>|Record<string,string>} groupTexts CelesTrak group → TLE text.
 * @param {string[]} categoryIds Enabled categories.
 * @returns {Array<{norad:number, name:string, line1:string, line2:string, category:string, group:string, summary:object}>}
 */
export function buildSatelliteGroupRecords(groupTexts, categoryIds) {
  const texts =
    groupTexts instanceof Map
      ? groupTexts
      : new Map(Object.entries(groupTexts));
  const enabled = new Set(categoryIds);
  const seen = new Set();
  const records = [];
  for (const category of SATELLITE_GROUP_CATEGORIES) {
    if (!enabled.has(category.id)) continue;
    for (const group of category.groups) {
      const text = texts.get(group);
      if (typeof text !== 'string') continue;
      for (const { name, line1, line2 } of parseTleText(text)) {
        const summary = tleOrbitSummary(line1, line2);
        if (!summary || seen.has(summary.norad)) continue;
        seen.add(summary.norad);
        records.push({
          norad: summary.norad,
          name: String(name).replace(/^0 /, '').trim().slice(0, 64),
          line1,
          line2,
          category: category.id,
          group,
          summary,
        });
        if (records.length >= MAX_GROUP_RECORDS) return records;
      }
    }
  }
  return records;
}

/**
 * Count records per category.
 * @param {Array<{category:string}>} records
 * @returns {Record<string, number>}
 */
export function countByCategory(records) {
  const counts = {};
  for (const record of records)
    counts[record.category] = (counts[record.category] || 0) + 1;
  return counts;
}

/**
 * JSON-safe analyst record for one satellite.
 * @param {object} record
 * @param {{latitude:number, longitude:number, altitude:number}|null} position
 */
export function satelliteGroupAnalystRecord(record, position) {
  const s = record.summary;
  return {
    id: String(record.norad),
    name: record.name,
    category: record.category,
    regime: s.regime,
    inclinationDeg: Math.round(s.inclinationDeg * 100) / 100,
    perigeeKm: Math.round(s.perigeeKm),
    apogeeKm: Math.round(s.apogeeKm),
    periodMin: Math.round(s.periodMin * 10) / 10,
    tleEpochMs: s.epochMs,
    lat: position ? position.latitude : null,
    lon: position ? position.longitude : null,
    altitudeKm: position ? Math.round(position.altitude / 1000) : null,
  };
}
