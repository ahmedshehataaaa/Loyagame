import { useQuery } from '@tanstack/react-query';

/* The admin API client.

   AUTH. Every endpoint here is gated by `isAdmin()` in lib/db.mjs, which
   constant-time-compares an `x-admin-key` header against process.env.ADMIN_KEY.
   The key is therefore a secret the OPERATOR types in, never a value baked into
   this bundle — a build-time constant would ship the admin key to anyone who
   fetches the JS.

   It is held in sessionStorage rather than localStorage so it dies with the
   tab, and it is only ever sent as a request HEADER — never a query string,
   which would land it in server logs, browser history and any Referer.

   POLLING. Step 4's requirement: a coupon minted mid-round should appear
   without a manual refresh. React Query's refetchInterval does that; there is
   deliberately no websocket/SSE. */

const KEY_STORAGE = 'claimlabs.adminKey';

export const getAdminKey = () => sessionStorage.getItem(KEY_STORAGE) || '';
export const setAdminKey = (k) => sessionStorage.setItem(KEY_STORAGE, k);
export const clearAdminKey = () => sessionStorage.removeItem(KEY_STORAGE);

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function adminFetch(path) {
  const key = getAdminKey();
  if (!key) throw new ApiError('no_admin_key', 401);

  const res = await fetch(path, {
    headers: { 'x-admin-key': key },
    cache: 'no-store',
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* A non-JSON body (an HTML error page from the host, say) is still an
       error worth surfacing — fall through to the status check below. */
  }

  if (!res.ok || body?.ok === false) {
    throw new ApiError(body?.error || `http_${res.status}`, res.status);
  }
  return body;
}

/* 10s: fast enough that a round finishing on the shop floor shows up while
   the operator is still looking at the screen, slow enough that an idle
   dashboard is not hammering Supabase. */
const POLL_MS = 10_000;

/** Auth failures must not be retried — the key is wrong, and retrying just
    burns requests before the gate can re-prompt. */
const baseOptions = {
  refetchInterval: POLL_MS,
  refetchOnWindowFocus: true,
  retry: (failureCount, error) => error?.status !== 401 && failureCount < 2,
};

export function useOverview() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminFetch('/api/admin-stats'),
    ...baseOptions,
  });
}

export function usePlayers({ page = 1, pageSize = 25, q = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) params.set('q', q);
  return useQuery({
    queryKey: ['admin', 'players', page, pageSize, q],
    queryFn: () => adminFetch(`/api/admin-players?${params}`),
    placeholderData: (prev) => prev, // keep the table on screen while paging
    ...baseOptions,
  });
}

export function useRedemptions({ page = 1, pageSize = 25 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return useQuery({
    queryKey: ['admin', 'redemptions', page, pageSize],
    queryFn: () => adminFetch(`/api/admin-redemptions?${params}`),
    placeholderData: (prev) => prev,
    ...baseOptions,
  });
}

/** 30 days, per the brief's line chart. The endpoint clamps to 90. */
export function useEngagement(days = 30) {
  return useQuery({
    queryKey: ['admin', 'engagement', days],
    queryFn: () => adminFetch(`/api/admin-engagement?days=${days}`),
    ...baseOptions,
  });
}

export function useFraud({ page = 1, pageSize = 25 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return useQuery({
    queryKey: ['admin', 'fraud', page, pageSize],
    queryFn: () => adminFetch(`/api/admin-fraud?${params}`),
    placeholderData: (prev) => prev,
    ...baseOptions,
  });
}

/** Probe used by the gate to validate a key before storing it for the session. */
export async function verifyAdminKey(key) {
  const res = await fetch('/api/admin-stats', {
    headers: { 'x-admin-key': key },
    cache: 'no-store',
  });
  return res.ok;
}
