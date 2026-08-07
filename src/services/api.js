/* ============================================================
   Low-level API transport.

   One place that knows how to talk to the backend, so every caller gets
   the same timeout, the same error taxonomy, and — most importantly —
   the same guarantee: a failure is always reported as a failure. Nothing
   in this file ever invents a success-shaped result.

   Errors are returned, not thrown. A reward flow that depends on
   distinguishing "server said no" from "we never reached the server"
   cannot use exceptions for one and a value for the other.
   ============================================================ */

/**
 * Error kinds callers may branch on. Anything unrecognised collapses to
 * `server_error`, which callers must treat as "no reward" — never as "maybe".
 * @typedef {'offline'|'timeout'|'network'|'bad_response'|'server_error'
 *   |'invalid_token'|'rate_limited'|'not_configured'} ApiErrorKind
 */

/**
 * Success and failure are separate shapes so `result.ok` discriminates them.
 * Each carries the other's fields as `?: undefined`, which is what lets a
 * caller read `result.kind` directly without TypeScript demanding a narrowing
 * dance for what is, at runtime, a plain property check.
 *
 * @template T
 * @typedef {{ok: true, data: T, kind?: undefined, status?: undefined, detail?: undefined}} ApiOk
 */

/**
 * @typedef {{ok: false, kind: ApiErrorKind, status?: number, detail?: string, data?: undefined}} ApiErr
 */

/**
 * @template T
 * @typedef {ApiOk<T> | ApiErr} ApiResult
 */

const DEFAULT_TIMEOUT_MS = 8000;

/** Map an HTTP status + server error string onto our taxonomy. */
function classify(status, serverError) {
  if (status === 409 || serverError === 'invalid_token') return 'invalid_token';
  if (status === 429) return 'rate_limited';
  return 'server_error';
}

/**
 * POST JSON to an API path.
 *
 * @template T
 * @param {string} path e.g. '/start-run'
 * @param {object} body
 * @param {{base?: string, timeoutMs?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<ApiResult<T>>}
 */
export async function postJson(path, body, opts = {}) {
  const base = opts.base ?? window.CONFIG?.API?.base ?? '/api';
  const enabled = window.CONFIG?.API?.enabled !== false;
  if (!enabled) return { ok: false, kind: 'not_configured' };

  // A known-offline device is worth distinguishing from a server that is up
  // but refusing — the UI copy differs and so does the retry advice.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, kind: 'offline' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: opts.signal ?? controller.signal,
      // Reward calls must never be served from a cache.
      cache: 'no-store',
      credentials: 'same-origin',
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      return { ok: false, kind: 'bad_response', status: res.status };
    }

    if (!res.ok || payload?.ok === false) {
      return {
        ok: false,
        kind: classify(res.status, payload?.error),
        status: res.status,
        detail: typeof payload?.error === 'string' ? payload.error : undefined,
      };
    }

    // The envelope is {ok:true, ...fields}; hand callers the fields.
    return { ok: true, data: /** @type {T} */ (payload) };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, kind: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
