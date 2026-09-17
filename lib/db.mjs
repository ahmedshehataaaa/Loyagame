/* Shared helpers for the reward API — Vercel Functions in api/, mirrored for
   Netlify in netlify/functions/. Talks to Supabase Postgres through PostgREST
   with plain fetch — no npm dependencies, nothing to bundle.

   TENANCY (ADR 0018)
   Every database call carries a JWT minted here, per request, for a database
   role that CANNOT bypass Row-Level Security:

     app_tenant       one tenant's player and brand-admin traffic
     ops_admin        ClaimLabs staff (api/ops-*.mjs)
     tenant_resolver  looks a tenant up by slug, and nothing else

   Tokens live 60 seconds and never leave the server. The service key is no
   longer used for data at all — it survives only to sign brand-asset uploads
   (api/ops-assets.mjs). A call that reaches sb() without a token is a bug, and
   it throws before any request is made. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** The pre-tenancy build's tenant, fixed by database/migrations/0002. */
export const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const LEGACY_TENANT_SLUG = 'mcdonalds';
/** Same rule as tenants.slug and brand.id in src/campaign/schema.js. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Env is read per call rather than captured at import, so the integration
   tests can point a module that is already loaded at their own database. */
const restBase = () =>
  process.env.SUPABASE_REST_URL?.replace(/\/$/, '') || `${process.env.SUPABASE_URL}/rest/v1`;

export const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
export const ok = (obj = {}) => json(200, { ok: true, ...obj });
export const bad = (error, status = 400) => json(status, { ok: false, error });

/* ---- database access --------------------------------------------------- */

/** A refusal from PostgREST, with Postgres's SQLSTATE and message kept apart. */
export class DbError extends Error {
  constructor(status, text, path) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON — keep the raw text */
    }
    super(`supabase ${status} ${path}: ${String(parsed?.message ?? text).slice(0, 300)}`);
    this.status = status;
    this.code = parsed?.code ?? null;
    this.dbMessage = parsed?.message ?? null;
  }
}

/**
 * @param {string} path  PostgREST path, e.g. `/players?phone=eq.%2B20...`
 * @param {{method?: string, body?: any, headers?: Record<string, string>}} opts
 * @param {{token: string}} ctx  from tenantContext() / opsContext() / resolverContext()
 */
export async function sb(path, { method = 'GET', body, headers = {} } = {}, ctx) {
  if (!ctx?.token) {
    throw new Error(`sb ${path}: no scoped token — refusing an unscoped database call`);
  }
  /** @type {Record<string, string>} */
  const h = {
    Authorization: `Bearer ${ctx.token}`,
    'Content-Type': 'application/json',
    ...headers,
  };
  // Supabase's gateway wants a project key; the Authorization token is what
  // PostgREST actually authorises with. The anon key grants nothing (0004).
  if (process.env.SUPABASE_ANON_KEY) h.apikey = process.env.SUPABASE_ANON_KEY;

  const res = await fetch(`${restBase()}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new DbError(res.status, text, path);
  return text ? JSON.parse(text) : null;
}

export const rpc = (fn, args, ctx) => sb(`/rpc/${fn}`, { method: 'POST', body: args ?? {} }, ctx);

/**
 * Turn a database refusal into a response.
 *
 * Only reasons the SQL raised ON PURPOSE pass through — machine-readable codes
 * like `slug_reserved` or `tenant_inactive`. Anything else is logged and becomes
 * a plain 500, so no internal error text or schema detail reaches a caller.
 */
export function dbFailure(where, e) {
  if (e instanceof DbError) {
    const reason = e.dbMessage ?? '';
    if (reason === 'tenant_inactive') return bad('tenant_inactive', 403);
    if (e.code === '22023' && /^[a-z_]+(:[a-z0-9_-]+)?$/.test(reason)) return bad(reason, 400);
    if (e.code === '23505') return bad(reason === 'slug_taken' ? 'slug_taken' : 'conflict', 409);
    if (e.code === '23514') {
      // new row for relation "tenants" violates check constraint "tenants_coupon_prefix_check"
      const field = /"[a-z_]+?_([a-z_]+)_check"/.exec(reason)?.[1];
      return bad(field ? `invalid_${field}` : 'invalid_input', 400);
    }
  }
  console.error(`${where}:`, e.message);
  return bad('server_error', 500);
}

/* ---- tokens ------------------------------------------------------------ */

/** HS256, signed with the project's JWT secret, which PostgREST verifies. */
export function mintJwt(claims, { ttlSec = 60, now = Date.now() } = {}) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is not configured');
  const iat = Math.floor(now / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ ...claims, iat, exp: iat + ttlSec });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export const resolverContext = () => ({ token: mintJwt({ role: 'tenant_resolver' }) });

/** ClaimLabs staff. Scoping to one tenant only matters for storage policies. */
export const opsContext = (tenantId) => ({
  token: mintJwt({ role: 'ops_admin', ...(tenantId ? { tenant_id: tenantId } : {}) }),
});

/* ---- tenant resolution ------------------------------------------------- */

/* A warm instance serves many requests; looking the tenant up for every one
   would double the database round trips of the hottest endpoints. Status is
   cached for at most this long — and the money paths do not rely on it:
   start_play and resolve_run re-check a live tenant inside the transaction. */
const TENANT_CACHE_MS = 15000;
const tenantCache = new Map();
export const clearTenantCache = () => tenantCache.clear();

export async function resolveTenant(slug) {
  const hit = tenantCache.get(slug);
  if (hit && Date.now() - hit.at < TENANT_CACHE_MS) return hit.tenant;
  const rows = await rpc('resolve_tenant', { p_slug: slug }, resolverContext());
  const tenant = rows?.[0] ?? null;
  tenantCache.set(slug, { at: Date.now(), tenant });
  return tenant;
}

/**
 * Which tenant a request names: the `X-Tenant` header, else `?tenant=`.
 * Neither means the pre-tenancy build — every client in the field today sends
 * nothing and must keep reaching McDonald's. Returns null for a malformed slug.
 */
export function requestedSlug(req) {
  const raw = req.headers.get('x-tenant') ?? new URL(req.url).searchParams.get('tenant');
  if (raw == null || raw === '') return process.env.DEFAULT_TENANT_SLUG || LEGACY_TENANT_SLUG;
  return SLUG_RE.test(raw) ? raw : null;
}

/**
 * Resolve the request's tenant and mint its database token.
 *
 * @param {Request} req
 * @param {{live?: boolean, hideMissing?: boolean}} [opts]
 *   live         the endpoint starts, pays or shows a round: the tenant must be
 *                trial/active AND published (McDonald's plays from the built-in
 *                config and has no published manifest by design).
 *   hideMissing  authenticated endpoints answer an unknown tenant with the same
 *                401 as a wrong key, so they cannot be used to list tenants.
 * @returns {Promise<{tenant?: any, ctx?: {tenant: any, token: string}, error?: Response}>}
 */
export async function tenantContext(req, { live = false, hideMissing = false } = {}) {
  const slug = requestedSlug(req);
  if (!slug) return { error: hideMissing ? bad('unauthorized', 401) : bad('invalid_tenant') };

  const tenant = await resolveTenant(slug);
  if (!tenant) {
    return { error: hideMissing ? bad('unauthorized', 401) : bad('tenant_not_found', 404) };
  }
  if (live) {
    if (tenant.status !== 'trial' && tenant.status !== 'active') {
      return { error: bad('tenant_inactive', 403) };
    }
    if (!tenant.published && tenant.id !== LEGACY_TENANT_ID) {
      return { error: bad('tenant_not_published', 403) };
    }
  }
  const token = mintJwt({ role: 'app_tenant', tenant_id: tenant.id });
  return { tenant, ctx: { tenant, token } };
}

/* ---- request helpers --------------------------------------------------- */

// Mirrors LoyaltyData.normalizePhone (js/data.js): cc + 6–13 digits.
export function normalizePhone(cc, num) {
  const digits = String(num || '').replace(/\D/g, '');
  return { ok: digits.length >= 6 && digits.length <= 13, e164: `${cc}${digits}` };
}

// Looser form for POS payloads: Foodics may send local Egyptian
// numbers ("01xxxxxxxxx") — default those to +20.
export function normalizeLoosePhone(raw) {
  const s = String(raw || '').trim();
  const digits = s.replace(/\D/g, '');
  if (!digits || digits.length < 6) return null;
  if (s.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

// Stat months roll over on Cairo time, not the device's.
export function monthKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).format(d); // "YYYY-MM"
}

export async function playerByToken(token, ctx) {
  if (!token || !UUID_RE.test(token)) return null;
  const rows = await sb(`/players?device_token=eq.${token}&limit=1`, {}, ctx);
  return rows[0] || null;
}

export async function playerByPhone(e164, ctx) {
  const rows = await sb(`/players?phone=eq.${encodeURIComponent(e164)}&limit=1`, {}, ctx);
  return rows[0] || null;
}

/** The calling tenant's settings — RLS returns no other tenant's rows. */
export async function getSettings(ctx) {
  const rows = await sb('/settings?select=key,value', {}, ctx);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/* ---- secrets ----------------------------------------------------------- */

// Constant-time secret comparison. Both sides are SHA-256'd first so the
// buffers are always equal length — that keeps timingSafeEqual from throwing
// and stops the comparison leaking the key's length as well as its content.
const digest = (v) => createHash('sha256').update(String(v)).digest();
export const secretEquals = (a, b) => {
  if (!a || !b) return false;
  try {
    return timingSafeEqual(digest(a), digest(b));
  } catch {
    return false;
  }
};

export const sha256hex = (v) => createHash('sha256').update(String(v)).digest('hex');

/** A presented secret against a stored sha256 hex (tenants.*_hash). */
const hashMatches = (presented, storedHex) =>
  !!presented && !!storedHex && secretEquals(sha256hex(presented), storedHex);

/** ClaimLabs staff: the ops endpoints. */
export const isOpsAdmin = (req) =>
  secretEquals(req.headers.get('x-ops-key'), process.env.OPS_ADMIN_KEY);

/**
 * Brand-admin access to ONE tenant: that tenant's own key, ClaimLabs ops, or —
 * for McDonald's only — the pre-tenancy global ADMIN_KEY, so the existing brand
 * dashboard keeps working. A tenant key opens nothing but its own tenant.
 */
export function isAdminFor(req, tenant) {
  const key = req.headers.get('x-admin-key');
  if (!key || !tenant) return false;
  if (secretEquals(key, process.env.OPS_ADMIN_KEY)) return true;
  if (hashMatches(key, tenant.admin_key_hash)) return true;
  return tenant.id === LEGACY_TENANT_ID && secretEquals(key, process.env.ADMIN_KEY);
}

/** Order-points credit: brand admin, or the tenant's own POS webhook secret. */
export function isPosCallerFor(req, tenant) {
  if (isAdminFor(req, tenant)) return true;
  const secret = req.headers.get('x-webhook-secret');
  if (hashMatches(secret, tenant?.pos_secret_hash)) return true;
  return tenant?.id === LEGACY_TENANT_ID && secretEquals(secret, process.env.FOODICS_WEBHOOK_SECRET);
}

/* ---- draft previews ------------------------------------------------------ */

/* A preview link lets a browser load an UNPUBLISHED draft, so it is signed and
   short-lived. The key is derived from the JWT secret rather than being one
   more environment variable to configure and rotate. */
const previewKey = () => {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is not configured');
  return createHmac('sha256', secret).update('claimlabs-preview-v1').digest();
};

export function signPreviewToken(slug, versionId, { ttlSec = 1800, now = Date.now() } = {}) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = createHmac('sha256', previewKey())
    .update(`${slug}.${versionId}.${exp}`)
    .digest('base64url');
  return `${versionId}.${exp}.${sig}`;
}

/** @returns {number|null} the version id, or null if forged, for another slug, or expired */
export function verifyPreviewToken(slug, token, { now = Date.now() } = {}) {
  const m = /^(\d{1,18})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? ''));
  if (!m) return null;
  const [, versionId, exp, sig] = m;
  if (Number(exp) * 1000 < now) return null;
  const expected = createHmac('sha256', previewKey())
    .update(`${slug}.${versionId}.${exp}`)
    .digest('base64url');
  return secretEquals(sig, expected) ? Number(versionId) : null;
}
