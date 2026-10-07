/**
 * @module crewedStations/records
 * @description Pure crew-roster parsers for the Crewed Stations layer, shared
 * by the Node provider and the browser source.
 *
 * There is no official machine-readable crew API from NASA or CMSA. Two open,
 * community-maintained feeds are used, and the layer labels them as such:
 * - Open Notify `astros.json` (name + craft only),
 * - corquaid "International Space Station APIs" `people-in-space.json`
 *   (adds agency, role, spacecraft and launch time).
 * Only public mission roles are kept. Images and social links are dropped.
 */

export const OPEN_NOTIFY_ASTROS_URL = 'http://api.open-notify.org/astros.json';
export const CORQUAID_PEOPLE_URL =
  'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json';

/** CelesTrak catalog numbers for the crewed stations' core modules. */
export const STATION_NORAD = Object.freeze({
  ISS: 25544, // ISS (ZARYA)
  TIANGONG: 48274, // CSS (TIANHE)
});

const MAX_PEOPLE = 40;

function text(value, max = 80) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Normalize a craft name onto the two stations this layer draws.
 * @param {unknown} value Craft or spacecraft name.
 * @param {boolean|undefined} iss corquaid's `iss` flag when present.
 * @returns {'ISS'|'Tiangong'|string|null}
 */
export function normalizeCraft(value, iss) {
  if (iss === true) return 'ISS';
  const name = text(value, 40);
  if (!name) return null;
  if (/^iss$|international space station/i.test(name)) return 'ISS';
  if (/tiangong|^css$|shenzhou|tianhe|chinese space station/i.test(name))
    return 'Tiangong';
  return name;
}

/**
 * Parse Open Notify `astros.json`.
 * @param {unknown} payload
 * @returns {Array<{name:string, craft:string}>|null} null when malformed.
 */
export function parseOpenNotify(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.message !== 'success' ||
    !Array.isArray(payload.people) ||
    payload.people.length > MAX_PEOPLE
  )
    return null;
  const people = [];
  for (const raw of payload.people) {
    const name = text(raw?.name);
    const craft = normalizeCraft(raw?.craft);
    if (name && craft) people.push({ name, craft });
  }
  return people.length ? people : null;
}

/**
 * Parse corquaid `people-in-space.json`.
 * @param {unknown} payload
 * @returns {Array<{name:string, craft:string, agency:?string, role:?string, spacecraft:?string, launchedAt:?number}>|null}
 */
export function parseCorquaid(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.people) ||
    payload.people.length > MAX_PEOPLE
  )
    return null;
  const people = [];
  for (const raw of payload.people) {
    const name = text(raw?.name);
    const spacecraft = text(raw?.spacecraft, 40);
    const craft = normalizeCraft(
      raw?.iss === false && !spacecraft ? null : spacecraft,
      raw?.iss,
    );
    if (!name || !craft) continue;
    const launched = Number(raw?.launched);
    people.push({
      name,
      craft,
      agency: text(raw?.agency, 24),
      role: text(raw?.position, 40),
      spacecraft,
      // corquaid publishes Unix seconds.
      launchedAt:
        Number.isFinite(launched) && launched > 0 && launched < 1e11
          ? launched * 1000
          : null,
    });
  }
  return people.length ? people : null;
}

/**
 * Crew counts per craft.
 * @param {Array<{craft:string}>} people
 * @returns {Record<string, number>}
 */
export function crewCounts(people) {
  const counts = {};
  for (const person of people || [])
    counts[person.craft] = (counts[person.craft] || 0) + 1;
  return counts;
}

/**
 * Validate the provider's crew snapshot in the browser.
 * @param {unknown} value `/api/space/crew` body.
 */
export function validateCrewSnapshot(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
    throw new Error('Malformed crew snapshot');
  const people = Array.isArray(value.people)
    ? value.people.slice(0, MAX_PEOPLE).flatMap((raw) => {
        const name = text(raw?.name);
        const craft = text(raw?.craft, 40);
        if (!name || !craft) return [];
        return [
          {
            name,
            craft,
            agency: text(raw?.agency, 24),
            role: text(raw?.role, 40),
            spacecraft: text(raw?.spacecraft, 40),
            launchedAt: Number.isFinite(raw?.launchedAt)
              ? raw.launchedAt
              : null,
          },
        ];
      })
    : [];
  return {
    schemaVersion: 1,
    source: text(value.source, 60) || 'Unavailable',
    fetchedAt: Number.isFinite(value.fetchedAt) ? value.fetchedAt : null,
    stale: value.stale === true,
    unavailable: value.unavailable === true || people.length === 0,
    reason: text(value.reason, 120),
    people,
    counts: crewCounts(people),
  };
}
