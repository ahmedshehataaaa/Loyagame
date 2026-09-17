import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  mintJwt,
  requestedSlug,
  isAdminFor,
  isPosCallerFor,
  isOpsAdmin,
  signPreviewToken,
  verifyPreviewToken,
  sha256hex,
  sb,
  dbFailure,
  DbError,
  LEGACY_TENANT_ID,
} from '../../lib/db.mjs';

/* The request-side half of tenant isolation (ADR 0018): which tenant a request
   names, which secrets open which tenant, and the tokens handed to PostgREST.
   The database half is proved against real Postgres in tests/integration/. */

const SECRET = 'unit-test-jwt-secret-0123456789abcdef';

beforeEach(() => {
  vi.stubEnv('SUPABASE_JWT_SECRET', SECRET);
  vi.stubEnv('OPS_ADMIN_KEY', 'ops-key');
  vi.stubEnv('ADMIN_KEY', 'legacy-admin-key');
  vi.stubEnv('FOODICS_WEBHOOK_SECRET', 'legacy-pos-secret');
  vi.stubEnv('DEFAULT_TENANT_SLUG', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const req = (headers = {}, url = 'http://game.test/api/x') => new Request(url, { headers });

const tenantA = { id: '11111111-1111-4111-8111-111111111111', admin_key_hash: sha256hex('key-a'), pos_secret_hash: sha256hex('pos-a') };
const tenantB = { id: '22222222-2222-4222-8222-222222222222', admin_key_hash: sha256hex('key-b'), pos_secret_hash: sha256hex('pos-b') };
const legacy = { id: LEGACY_TENANT_ID, admin_key_hash: null, pos_secret_hash: null };

describe('mintJwt', () => {
  it('produces an HS256 token PostgREST can verify with the project secret', () => {
    const token = mintJwt({ role: 'app_tenant', tenant_id: tenantA.id }, { now: 1_700_000_000_000 });
    const [head, body, sig] = token.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(claims).toMatchObject({ role: 'app_tenant', tenant_id: tenantA.id, iat: 1_700_000_000 });
    // Short-lived: a leaked token is useless within a minute.
    expect(claims.exp - claims.iat).toBe(60);
    expect(sig).toBe(createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url'));
  });

  it('refuses to mint without a secret rather than signing with nothing', () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
    expect(() => mintJwt({ role: 'app_tenant' })).toThrow(/SUPABASE_JWT_SECRET/);
  });
});

describe('requestedSlug', () => {
  it('reads X-Tenant, then ?tenant=', () => {
    expect(requestedSlug(req({ 'x-tenant': 'acme-burger' }))).toBe('acme-burger');
    expect(requestedSlug(req({}, 'http://game.test/api/x?tenant=nile-cafe'))).toBe('nile-cafe');
    expect(requestedSlug(req({ 'x-tenant': 'acme-burger' }, 'http://game.test/?tenant=nile-cafe'))).toBe(
      'acme-burger',
    );
  });

  it("no tenant at all means McDonald's — every client in the field today sends none", () => {
    expect(requestedSlug(req())).toBe('mcdonalds');
    vi.stubEnv('DEFAULT_TENANT_SLUG', 'demo-diner');
    expect(requestedSlug(req())).toBe('demo-diner');
  });

  it('a malformed slug is refused, never normalised into a real one', () => {
    for (const bad of ['../mcdonalds', 'ACME', 'a', 'acme burger', 'acme/../x', '-acme']) {
      expect(requestedSlug(req({ 'x-tenant': bad })), bad).toBeNull();
    }
  });
});

describe('brand admin access', () => {
  const as = (key) => req({ 'x-admin-key': key });

  it("a tenant's key opens that tenant and no other", () => {
    expect(isAdminFor(as('key-a'), tenantA)).toBe(true);
    expect(isAdminFor(as('key-a'), tenantB)).toBe(false);
    expect(isAdminFor(as('key-a'), legacy)).toBe(false);
  });

  it('the ClaimLabs ops key opens every tenant', () => {
    for (const t of [tenantA, tenantB, legacy]) expect(isAdminFor(as('ops-key'), t)).toBe(true);
  });

  it("the pre-tenancy ADMIN_KEY still opens McDonald's, and only McDonald's", () => {
    expect(isAdminFor(as('legacy-admin-key'), legacy)).toBe(true);
    expect(isAdminFor(as('legacy-admin-key'), tenantA)).toBe(false);
  });

  it('no key, an empty key or a tenant with no key set opens nothing', () => {
    expect(isAdminFor(req(), tenantA)).toBe(false);
    expect(isAdminFor(as(''), tenantA)).toBe(false);
    expect(isAdminFor(as('anything'), { id: tenantA.id, admin_key_hash: null })).toBe(false);
    expect(isAdminFor(as('key-a'), null)).toBe(false);
  });

  it('the stored hash itself is not a working key', () => {
    expect(isAdminFor(as(tenantA.admin_key_hash), tenantA)).toBe(false);
  });
});

describe('POS webhook access', () => {
  const pos = (secret) => req({ 'x-webhook-secret': secret });

  it("a tenant's POS secret credits only that tenant", () => {
    expect(isPosCallerFor(pos('pos-a'), tenantA)).toBe(true);
    expect(isPosCallerFor(pos('pos-a'), tenantB)).toBe(false);
  });

  it("the pre-tenancy Foodics secret keeps crediting McDonald's only", () => {
    expect(isPosCallerFor(pos('legacy-pos-secret'), legacy)).toBe(true);
    expect(isPosCallerFor(pos('legacy-pos-secret'), tenantA)).toBe(false);
  });

  it("the tenant's admin key is also accepted (manual credit)", () => {
    expect(isPosCallerFor(req({ 'x-admin-key': 'key-b' }), tenantB)).toBe(true);
  });
});

describe('ops access', () => {
  it('requires x-ops-key, not x-admin-key', () => {
    expect(isOpsAdmin(req({ 'x-ops-key': 'ops-key' }))).toBe(true);
    expect(isOpsAdmin(req({ 'x-admin-key': 'ops-key' }))).toBe(false);
    expect(isOpsAdmin(req({ 'x-ops-key': 'nope' }))).toBe(false);
  });
});

describe('preview tokens', () => {
  const now = 1_800_000_000_000;

  it('round-trip for the slug and version they were issued for', () => {
    const token = signPreviewToken('acme-burger', 42, { now });
    expect(verifyPreviewToken('acme-burger', token, { now })).toBe(42);
  });

  it('are refused for another slug, after expiry, or when tampered with', () => {
    const token = signPreviewToken('acme-burger', 42, { now, ttlSec: 60 });
    expect(verifyPreviewToken('nile-cafe', token, { now })).toBeNull();
    expect(verifyPreviewToken('acme-burger', token, { now: now + 61_000 })).toBeNull();
    const [, exp, sig] = token.split('.');
    expect(verifyPreviewToken('acme-burger', `43.${exp}.${sig}`, { now })).toBeNull();
    for (const junk of [null, '', 'x.y.z', '42.1.short']) {
      expect(verifyPreviewToken('acme-burger', junk, { now })).toBeNull();
    }
  });
});

describe('sb', () => {
  it('refuses an unscoped call before any request is made', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(sb('/players', {}, undefined)).rejects.toThrow(/no scoped token/);
    await expect(sb('/players', {}, { token: '' })).rejects.toThrow(/no scoped token/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the scoped token, never the service key', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.test');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-key');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
    const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await sb('/players?limit=1', {}, { token: 'scoped.jwt.token' });
    const [url, init] = /** @type {[string, RequestInit & {headers: Record<string, string>}]} */ (
      /** @type {unknown} */ (fetchSpy.mock.calls[0])
    );
    expect(url).toBe('https://project.supabase.test/rest/v1/players?limit=1');
    expect(init.headers.Authorization).toBe('Bearer scoped.jwt.token');
    expect(init.headers.apikey).toBe('anon-key');
    expect(JSON.stringify(init.headers)).not.toContain('service-key');
  });
});

describe('dbFailure', () => {
  const pgrst = (status, code, message) =>
    new DbError(status, JSON.stringify({ code, message }), '/rpc/x');
  const read = async (res) => ({ status: res.status, body: await res.json() });

  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

  it('passes through reasons the SQL raised on purpose', async () => {
    expect(await read(dbFailure('t', pgrst(400, '22023', 'slug_reserved')))).toEqual({
      status: 400,
      body: { ok: false, error: 'slug_reserved' },
    });
    expect((await read(dbFailure('t', pgrst(400, '22023', 'prize_label_missing:side1')))).body.error).toBe(
      'prize_label_missing:side1',
    );
    expect(await read(dbFailure('t', pgrst(403, '42501', 'tenant_inactive')))).toEqual({
      status: 403,
      body: { ok: false, error: 'tenant_inactive' },
    });
    expect((await read(dbFailure('t', pgrst(409, '23505', 'slug_taken')))).status).toBe(409);
  });

  it('names the field of a violated check constraint, without the SQL', async () => {
    const r = await read(
      dbFailure(
        't',
        pgrst(400, '23514', 'new row for relation "tenants" violates check constraint "tenants_coupon_prefix_check"'),
      ),
    );
    expect(r).toEqual({ status: 400, body: { ok: false, error: 'invalid_coupon_prefix' } });
  });

  it('hides everything else behind a plain 500', async () => {
    for (const e of [
      pgrst(400, '22023', 'relation "players" has a secret column'),
      pgrst(403, '42501', 'permission denied for function admin_dashboard'),
      new Error('socket hang up'),
    ]) {
      const r = await read(dbFailure('t', e));
      expect(r).toEqual({ status: 500, body: { ok: false, error: 'server_error' } });
    }
  });
});
