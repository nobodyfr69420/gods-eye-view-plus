import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The ME track store: one append-only JSON-lines file of fixes under
 * .gev-cache/me/ on this machine, mirrored in memory (sorted by time) for
 * queries. Nothing here leaves the machine.
 */

const DEFAULT_MAX_FIXES = 250_000;

export function createMeStore({
  dir = path.join(process.cwd(), '.gev-cache', 'me'),
  fileSystem = fs,
  maxFixes = DEFAULT_MAX_FIXES,
  env = process.env,
} = {}) {
  const file = path.join(dir, 'fixes.jsonl');
  const tokenFile = path.join(dir, 'ingest-token');
  let fixes = null; // sorted by t
  const seen = new Set(); // device|t

  function ensureDir() {
    fileSystem.mkdirSync(dir, { recursive: true });
  }

  function load() {
    if (fixes) return fixes;
    fixes = [];
    let text = '';
    try {
      text = fileSystem.readFileSync(file, 'utf8');
    } catch {
      return fixes;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const fix = JSON.parse(line);
        if (Number.isFinite(fix?.t) && Number.isFinite(fix?.lat)) {
          const key = `${fix.device}|${fix.t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          fixes.push(fix);
        }
      } catch {
        /* skip a torn line */
      }
    }
    fixes.sort((a, b) => a.t - b.t);
    trim();
    return fixes;
  }

  function trim() {
    if (fixes.length <= maxFixes) return;
    const drop = fixes.splice(0, fixes.length - maxFixes);
    for (const fix of drop) seen.delete(`${fix.device}|${fix.t}`);
  }

  function insertSorted(fix) {
    if (!fixes.length || fixes[fixes.length - 1].t <= fix.t) {
      fixes.push(fix);
      return;
    }
    let lo = 0;
    let hi = fixes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fixes[mid].t <= fix.t) lo = mid + 1;
      else hi = mid;
    }
    fixes.splice(lo, 0, fix);
  }

  /** Add clean fixes; returns how many were new. */
  function add(batch) {
    load();
    const fresh = [];
    for (const fix of batch) {
      const key = `${fix.device}|${fix.t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insertSorted(fix);
      fresh.push(fix);
    }
    if (fresh.length) {
      ensureDir();
      fileSystem.appendFileSync(
        file,
        fresh.map((fix) => JSON.stringify(fix)).join('\n') + '\n',
        'utf8',
      );
      trim();
    }
    return fresh.length;
  }

  /** Latest fix, count and first time per device. */
  function devices() {
    const out = new Map();
    for (const fix of load()) {
      const entry = out.get(fix.device) || {
        device: fix.device,
        count: 0,
        first: fix.t,
        last: null,
        src: fix.src,
      };
      entry.count++;
      entry.last = fix;
      entry.src = fix.src;
      out.set(fix.device, entry);
    }
    return [...out.values()].sort((a, b) => b.last.t - a.last.t);
  }

  /** Fixes in a window, newest `limit` (chronological order). */
  function track({
    device = null,
    since = 0,
    until = Infinity,
    limit = 20_000,
  } = {}) {
    const list = load().filter(
      (fix) =>
        fix.t >= since && fix.t <= until && (!device || fix.device === device),
    );
    return list.slice(Math.max(0, list.length - limit));
  }

  /** Delete one device's history, or everything. */
  function forget(device = null) {
    load();
    const keep = device ? fixes.filter((fix) => fix.device !== device) : [];
    const removed = fixes.length - keep.length;
    fixes = keep;
    seen.clear();
    for (const fix of fixes) seen.add(`${fix.device}|${fix.t}`);
    ensureDir();
    const tmp = `${file}.${process.pid}.tmp`;
    fileSystem.writeFileSync(
      tmp,
      fixes.map((fix) => JSON.stringify(fix)).join('\n') +
        (fixes.length ? '\n' : ''),
      'utf8',
    );
    fileSystem.renameSync(tmp, file);
    return removed;
  }

  /** ME_INGEST_TOKEN, or a per-machine token generated once and kept here. */
  function token() {
    const fromEnv = String(env.ME_INGEST_TOKEN ?? '').trim();
    if (fromEnv) return fromEnv;
    try {
      const saved = fileSystem.readFileSync(tokenFile, 'utf8').trim();
      if (saved.length >= 16) return saved;
    } catch {
      /* first run */
    }
    const fresh = randomBytes(24).toString('base64url');
    ensureDir();
    fileSystem.writeFileSync(tokenFile, fresh, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return fresh;
  }

  return { add, devices, track, forget, token, file };
}
