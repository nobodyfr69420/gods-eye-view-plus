/**
 * Process-scoped cache for one fixed upstream feed.
 *
 * One refresh is in flight at a time; every caller within `ttlMs` shares the
 * cached value. After a failure the provider waits `retryMs` before asking the
 * upstream again, and keeps serving the last good value (flagged stale) for up
 * to `staleMaxMs`. Nothing here chooses a destination: the caller's `load`
 * function owns its fixed URLs, credentials, limits and validation.
 *
 * @param {object} options
 * @param {(signal: AbortSignal) => Promise<object>} options.load Fetch + validate.
 * @param {number} options.ttlMs Fresh window.
 * @param {number} options.staleMaxMs Longest a stale value may be served.
 * @param {number} [options.retryMs=60000] Minimum wait between failed attempts.
 * @param {number} [options.timeoutMs=15000] Per-refresh deadline.
 * @param {() => number} [options.now] Clock.
 * @returns {{read: () => Promise<{value: object|null, fetchedAt: number|null, stale: boolean, error: string|null}>, peek: () => object|null}}
 */
export function createFeedCache({
  load,
  ttlMs,
  staleMaxMs,
  retryMs = 60_000,
  timeoutMs = 15_000,
  now = () => Date.now(),
}) {
  if (typeof load !== 'function')
    throw new TypeError('A feed loader is required');
  let cache = null; // { value, fetchedAt }
  let inflight = null;
  let attemptedAt = -Infinity;
  let lastError = null;

  function describe(stale) {
    const usable = cache && now() - cache.fetchedAt <= staleMaxMs;
    return {
      value: usable ? cache.value : null,
      fetchedAt: usable ? cache.fetchedAt : null,
      stale: usable ? stale : true,
      error: stale ? lastError || 'upstream unavailable' : null,
    };
  }

  async function refresh() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const value = await load(controller.signal);
      cache = { value, fetchedAt: now() };
      lastError = null;
      return true;
    } catch (error) {
      lastError =
        error?.name === 'AbortError' || controller.signal.aborted
          ? 'upstream timed out'
          : String(error?.message || 'upstream unavailable').slice(0, 120);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async read() {
      if (cache && now() - cache.fetchedAt < ttlMs) return describe(false);
      if (!inflight) {
        if (now() - attemptedAt < retryMs) return describe(true);
        attemptedAt = now();
        inflight = refresh().finally(() => {
          inflight = null;
        });
      }
      const ok = await inflight;
      return describe(!ok);
    },
    peek() {
      return cache;
    },
  };
}

/**
 * Fetch one fixed public URL and parse JSON under a byte cap.
 * @param {Function} fetchImpl fetch implementation.
 * @param {string} url Fixed upstream URL.
 * @param {number} cap Maximum body bytes.
 * @param {AbortSignal} signal Refresh deadline.
 * @param {(response: Response, cap: number, signal: AbortSignal) => Promise<string>} readText Capped reader.
 * @returns {Promise<unknown>}
 */
export async function fetchJsonCapped(fetchImpl, url, cap, signal, readText) {
  const response = await fetchImpl(url, {
    signal,
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'gods-eye-view-space/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)',
    },
  });
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(`HTTP ${response.status}`);
  }
  return JSON.parse(await readText(response, cap, signal));
}

/**
 * Write one JSON response unless the client already went away.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
