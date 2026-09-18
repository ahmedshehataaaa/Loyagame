import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import { startStack, manifestFor, STANDARD_LABELS, JWT_SECRET, LEGACY_TENANT } from './support/stack.js';
import { clearTenantCache } from '../../lib/db.mjs';
import opsTenants from '../../api/ops-tenants.mjs';
import opsAssets from '../../api/ops-assets.mjs';
import tenantConfig from '../../api/tenant-config.mjs';
import register from '../../api/register.mjs';
import posCredit from '../../api/pos-credit.mjs';
import startRun from '../../api/start-run.mjs';
import submitRun from '../../api/submit-run.mjs';
import sessionStatus from '../../api/session-status.mjs';
import admin from '../../api/admin.mjs';

/* Phase 2 pass/fail, end to end: the REAL handlers, calling the REAL PostgREST
 * binary, over a real Postgres with the migrations applied.
 *
 *   • a tenant created through the API gets a working, isolated config;
 *   • players, POS secrets, admin keys, round tokens and coupons from one
 *     tenant are useless at another;
 *   • the money logic is untouched and still server-side.
 *
 * SUPABASE_SERVICE_KEY is set to a value PostgREST would reject. Every data
 * path below succeeding therefore also proves no handler uses it. */

const OPS_KEY = 'ops-key-for-integration-tests';
const PHONE = { cc: '+20', phone: '1009990000', pos: '01009990000' };
const ACTOR = 'Meera Nabil';

let stack;
let storage;
const storageCalls = [];
const state = {};

/**
 * @param {(req: Request) => Promise<Response>} handler
 * @param {{method?: string, path?: string, headers?: Record<string, string>, body?: any}} [opts]
 */
async function call(handler, { method = 'GET', path = '/', headers = {}, body } = {}) {
  const res = await handler(
    new Request(`http://game.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const ops = (body) =>
  call(opsTenants, { method: 'POST', headers: { 'x-ops-key': OPS_KEY }, body: { actor: ACTOR, ...body } });
const post = (handler, slug, body, headers = {}) =>
  call(handler, {
    method: 'POST',
    headers: { ...(slug ? { 'x-tenant': slug } : {}), ...headers },
    body,
  });

/** Backdate a round so resolve_run accepts a 31-second survival as genuine. */
const backdate = (token) =>
  stack.admin.query("update runs set created_at = now() - interval '40 seconds' where token = $1", [token]);

beforeAll(async () => {
  stack = await startStack({ postgrest: true });

  // Stands in for Supabase Storage's sign endpoint; records what it was sent.
  storage = createServer((req, res) => {
    storageCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const m = /^\/storage\/v1\/object\/upload\/sign\/(.+)$/.exec(req.url ?? '');
    res.writeHead(m ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(m ? { url: `/object/upload/sign/${m[1]}?token=signed` } : {}));
  });
  await new Promise((resolve) => storage.listen(0, '127.0.0.1', resolve));

  vi.stubEnv('SUPABASE_REST_URL', stack.restUrl);
  const { port } = /** @type {import('node:net').AddressInfo} */ (storage.address());
  vi.stubEnv('SUPABASE_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('SUPABASE_JWT_SECRET', JWT_SECRET);
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'not-a-valid-jwt-postgrest-would-reject-it');
  vi.stubEnv('SUPABASE_ANON_KEY', '');
  vi.stubEnv('OPS_ADMIN_KEY', OPS_KEY);
  vi.stubEnv('ADMIN_KEY', 'legacy-admin-key');
  vi.stubEnv('FOODICS_WEBHOOK_SECRET', 'legacy-foodics-secret');
  vi.stubEnv('DEFAULT_TENANT_SLUG', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  vi.unstubAllEnvs();
  storage?.close();
  await stack?.stop();
});

describe('onboarding through the ops API', () => {
  it('requires the ops key', async () => {
    expect((await call(opsTenants)).status).toBe(401);
    expect((await call(opsTenants, { headers: { 'x-admin-key': OPS_KEY } })).status).toBe(401);
  });

  it('creates, drafts, reviews, publishes and keys two tenants', async () => {
    expect((await ops({ action: 'review_preset', presetId: 'standard-10' })).status).toBe(200);

    for (const [slug, name, prefix] of [
      ['acme-burger', 'Acme Burger', 'AB'],
      ['nile-cafe', 'Nile Cafe', 'NC'],
    ]) {
      const created = await ops({ action: 'create', name, slug, gameFormat: 'slice_rush', couponPrefix: prefix });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const tenantId = created.body.tenant.id;

      const draft = await ops({
        action: 'save_draft',
        tenantId,
        manifest: manifestFor(slug, { name }),
        rewardPresetId: 'standard-10',
        prizeLabels: STANDARD_LABELS,
      });
      expect(draft.status, JSON.stringify(draft.body)).toBe(200);

      const published = await ops({ action: 'publish', versionId: draft.body.versionId });
      expect(published.status, JSON.stringify(published.body)).toBe(200);

      const keys = await ops({ action: 'rotate_keys', tenantId, keys: ['admin', 'pos'] });
      expect(keys.body.adminKey).toMatch(/^clk_/);
      expect(keys.body.posSecret).toMatch(/^clp_/);

      state[slug] = { id: tenantId, ...keys.body };
    }
  });

  it("passes the database's reasons back", async () => {
    const fries = await ops({ action: 'create', name: 'F', slug: 'fries-co', gameFormat: 'catch_fries', couponPrefix: 'FC' });
    expect(fries).toMatchObject({ status: 400, body: { error: 'game_format_unavailable' } });

    const dup = await ops({ action: 'create', name: 'A', slug: 'acme-burger', gameFormat: 'slice_rush', couponPrefix: 'AA' });
    expect(dup).toMatchObject({ status: 409, body: { error: 'slug_taken' } });

    const prefix = await ops({ action: 'create', name: 'P', slug: 'prefix-co', gameFormat: 'slice_rush', couponPrefix: 'lower' });
    expect(prefix).toMatchObject({ status: 400, body: { error: 'invalid_coupon_prefix' } });

    expect((await ops({ action: 'create', name: 'X', slug: 'x-co', gameFormat: 'slice_rush', couponPrefix: 'XC', actor: '' })).body.error).toBe(
      'actor_required',
    );
  });

  it('rejects an invalid manifest with the validator the game uses', async () => {
    const bad = manifestFor('acme-burger');
    bad.items[0].points = 0;
    const r = await ops({
      action: 'save_draft',
      tenantId: state['acme-burger'].id,
      manifest: bad,
      rewardPresetId: 'standard-10',
      prizeLabels: STANDARD_LABELS,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_manifest');
    expect(r.body.issues.some((i) => i.path === 'items[0].points')).toBe(true);
  });

  it('lists every tenant, and never returns a key once it has been shown', async () => {
    const overview = await call(opsTenants, { headers: { 'x-ops-key': OPS_KEY } });
    expect(overview.body.tenants.map((t) => t.slug).sort()).toEqual(['acme-burger', 'mcdonalds', 'nile-cafe']);

    const detail = await call(opsTenants, { path: '/?slug=acme-burger', headers: { 'x-ops-key': OPS_KEY } });
    expect(detail.body.detail.tenant).toMatchObject({ hasAdminKey: true, hasPosSecret: true, status: 'trial' });
    const text = JSON.stringify(detail.body);
    expect(text).not.toContain(state['acme-burger'].adminKey);
    expect(text).not.toContain(state['acme-burger'].posSecret);
  });
});

describe('the config a game boots from', () => {
  it('serves a published manifest, briefly cacheable', async () => {
    const r = await call(tenantConfig, { path: '/?slug=acme-burger' });
    expect(r.status).toBe(200);
    expect(r.body.manifest.brand.id).toBe('acme-burger');
    expect(r.body.manifest.rewards.prizes).toHaveLength(10);
    expect(r.headers.get('cache-control')).toBe('public, max-age=30');
  });

  it('serves nothing for an unknown or unpublished tenant', async () => {
    expect((await call(tenantConfig, { path: '/?slug=ghost-brand' })).status).toBe(404);
    const created = await ops({ action: 'create', name: 'Draft Only', slug: 'draft-only', gameFormat: 'slice_rush', couponPrefix: 'DO' });
    state['draft-only'] = { id: created.body.tenant.id };
    expect((await call(tenantConfig, { path: '/?slug=draft-only' })).status).toBe(404);
    expect((await call(tenantConfig, { path: '/?slug=../etc' })).status).toBe(400);
  });

  it('serves a draft only with a valid preview token for that tenant', async () => {
    const draft = await ops({
      action: 'save_draft',
      tenantId: state['draft-only'].id,
      manifest: manifestFor('draft-only', { name: 'Draft Only' }),
      rewardPresetId: 'standard-10',
      prizeLabels: STANDARD_LABELS,
    });
    const preview = await ops({ action: 'preview', slug: 'draft-only', versionId: draft.body.versionId });
    expect(preview.body.path).toMatch(/^\/play\/draft-only\/\?preview=/);

    const ok = await call(tenantConfig, { path: `/?slug=draft-only&preview=${encodeURIComponent(preview.body.token)}` });
    expect(ok).toMatchObject({ status: 200, body: { preview: true } });
    expect(ok.headers.get('cache-control')).toBe('no-store');

    const wrongSlug = await call(tenantConfig, { path: `/?slug=acme-burger&preview=${encodeURIComponent(preview.body.token)}` });
    expect(wrongSlug.status).toBe(403);
    const tampered = preview.body.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await call(tenantConfig, { path: `/?slug=draft-only&preview=${encodeURIComponent(tampered)}` })).status).toBe(403);
  });
});

describe('players at two brands', () => {
  it('earn, play and win at each brand independently — same phone', async () => {
    for (const slug of ['acme-burger', 'nile-cafe']) {
      const reg = await post(register, slug, { ...PHONE, consent: true });
      expect(reg.status, JSON.stringify(reg.body)).toBe(200);
      expect(reg.body.profile.orderPoints).toBe(0);

      const credit = await post(
        posCredit,
        slug,
        { phone: PHONE.pos, orderId: 'ORDER-1', points: slug === 'acme-burger' ? 6000 : 9000 },
        { 'x-webhook-secret': state[slug].posSecret },
      );
      expect(credit.status, JSON.stringify(credit.body)).toBe(200);
      expect(credit.body.duplicate).toBe(false); // same order id, different till system

      const start = await post(startRun, slug, { cc: PHONE.cc, phone: PHONE.phone, device: `device-${slug}` });
      expect(start.body.granted).toBe(true);
      await backdate(start.body.token);

      const result = await post(submitRun, slug, {
        token: start.body.token,
        score: 2400,
        durationMs: 31000,
        device: `device-${slug}`,
        survived: true,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.won).toBe(true);
      expect(result.body.code).toMatch(new RegExp(`^${slug === 'acme-burger' ? 'AB' : 'NC'}-`));
      expect(result.body.wheel.find((w) => w.key === 'side1').label).toBe('Free Fries');
      state[slug].orderPoints = result.body.orderPoints;
    }
    expect(state['acme-burger'].orderPoints).toBe(2000);
    expect(state['nile-cafe'].orderPoints).toBe(5000);
  });

  it('the client’s survived claim is still ignored: a short round wins nothing', async () => {
    const start = await post(startRun, 'nile-cafe', { cc: '+20', phone: '1004445555', device: 'd-short' });
    await backdate(start.body.token);
    const r = await post(submitRun, 'nile-cafe', {
      token: start.body.token,
      score: 999999,
      durationMs: 12000,
      device: 'd-short',
      survived: true,
    });
    expect(r.body).toMatchObject({ won: false, survived: false });
  });

  it("a round token cannot be spent at another brand", async () => {
    const start = await post(startRun, 'acme-burger', { cc: '+20', phone: '1007778888', device: 'd-cross' });
    await backdate(start.body.token);
    const r = await post(submitRun, 'nile-cafe', { token: start.body.token, score: 10, durationMs: 31000, device: 'd-cross' });
    expect(r).toMatchObject({ status: 409, body: { error: 'invalid_token' } });
  });

  it('eligibility and lockouts are per brand', async () => {
    const status = (slug) =>
      post(sessionStatus, slug, { cc: PHONE.cc, phone: PHONE.phone, device: 'another-device' });
    expect((await status('acme-burger')).body).toMatchObject({ eligible: false, reason: 'locked_win', orderPoints: 2000 });
    const none = await post(sessionStatus, 'draft-only', { cc: PHONE.cc, phone: PHONE.phone, device: 'x' });
    expect(none).toMatchObject({ status: 403, body: { error: 'tenant_not_published' } });
  });
});

describe('secrets open only their own tenant', () => {
  it("a POS secret credits only its tenant; an unknown tenant looks exactly like a wrong secret", async () => {
    const order = { phone: PHONE.pos, orderId: 'ORDER-X', points: 10 };
    expect((await post(posCredit, 'nile-cafe', order, { 'x-webhook-secret': state['acme-burger'].posSecret })).status).toBe(401);
    expect((await post(posCredit, 'acme-burger', order, { 'x-webhook-secret': 'legacy-foodics-secret' })).status).toBe(401);
    const ghost = await post(posCredit, 'ghost-brand', order, { 'x-webhook-secret': state['acme-burger'].posSecret });
    expect(ghost).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
  });

  it('brand admin keys read only their own tenant', async () => {
    const stats = (slug, key) =>
      call(admin, {
        path: '/api/admin?section=stats',
        headers: { ...(slug ? { 'x-tenant': slug } : {}), 'x-admin-key': key },
      });

    const own = await stats('acme-burger', state['acme-burger'].adminKey);
    expect(own.status).toBe(200);
    expect(own.body.stats.wheel.winsTotal).toBe(1);

    expect((await stats('nile-cafe', state['acme-burger'].adminKey)).status).toBe(401);
    expect((await stats('acme-burger', 'legacy-admin-key')).status).toBe(401);
    expect((await stats('nile-cafe', OPS_KEY)).status).toBe(200);
    expect((await stats(null, 'legacy-admin-key')).status).toBe(200);
  });

  it('a brand redeems its own coupons, and cannot touch another brand’s', async () => {
    const winOf = async (tenantId) =>
      Number((await stack.admin.query('select id from wheel_wins where tenant_id = $1 limit 1', [tenantId])).rows[0].id);
    const redeem = (slug, winId) =>
      call(admin, {
        path: '/api/admin?section=actions',
        method: 'POST',
        headers: { 'x-tenant': slug, 'x-admin-key': state[slug].adminKey },
        body: { action: 'redeem_prize', winId, redeemedBy: 'till-4' },
      });

    const nileWin = await winOf(state['nile-cafe'].id);
    expect((await redeem('acme-burger', nileWin)).status).toBe(404);
    expect((await redeem('nile-cafe', nileWin)).status).toBe(200);
    expect((await redeem('nile-cafe', nileWin)).body.error).toBe('already_redeemed');
  });
});

describe('tenant status', () => {
  it('a paused tenant cannot play, and its config disappears; its tills still credit', async () => {
    await ops({ action: 'set_status', tenantId: state['nile-cafe'].id, status: 'paused' });
    clearTenantCache();
    try {
      const start = await post(startRun, 'nile-cafe', { cc: '+20', phone: '1001112222', device: 'd-p' });
      expect(start).toMatchObject({ status: 403, body: { error: 'tenant_inactive' } });
      expect((await call(tenantConfig, { path: '/?slug=nile-cafe' })).status).toBe(404);
      const credit = await post(
        posCredit,
        'nile-cafe',
        { phone: PHONE.pos, orderId: 'ORDER-PAUSED', points: 5 },
        { 'x-webhook-secret': state['nile-cafe'].posSecret },
      );
      expect(credit.status).toBe(200);
    } finally {
      await ops({ action: 'set_status', tenantId: state['nile-cafe'].id, status: 'active' });
      clearTenantCache();
    }
  });

  it('even with a stale cached status, the database refuses a paused tenant’s round', async () => {
    await post(startRun, 'acme-burger', { cc: '+20', phone: '1003334444', device: 'd-warm' }); // warm the cache
    await ops({ action: 'set_status', tenantId: state['acme-burger'].id, status: 'paused' });
    try {
      const start = await post(startRun, 'acme-burger', { cc: '+20', phone: '1003334444', device: 'd-warm' });
      expect(start).toMatchObject({ status: 403, body: { error: 'tenant_inactive' } });
    } finally {
      await ops({ action: 'set_status', tenantId: state['acme-burger'].id, status: 'trial' });
      clearTenantCache();
    }
  });
});

describe("the pre-tenancy client keeps reaching McDonald's", () => {
  it('a request with no tenant registers a McDonald’s player', async () => {
    const r = await post(register, null, { cc: '+20', phone: '1006660000', consent: true });
    expect(r.status).toBe(200);
    const { rows } = await stack.admin.query('select tenant_id from players where id = $1', [r.body.playerId]);
    expect(rows[0].tenant_id).toBe(LEGACY_TENANT);
  });
});

describe('brand asset uploads', () => {
  const upload = (body) => call(opsAssets, { method: 'POST', headers: { 'x-ops-key': OPS_KEY }, body });

  it("builds the storage path itself, inside the tenant's folder", async () => {
    storageCalls.length = 0;
    const r = await upload({
      tenantId: state['acme-burger'].id,
      kind: 'item',
      contentType: 'image/webp',
      path: '../nile-cafe/logo.png', // ignored: callers do not choose paths
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.path).toMatch(
      new RegExp(`^${state['acme-burger'].id}/item/[0-9a-f-]{36}\\.webp$`),
    );
    expect(r.body.publicUrl).toMatch(/\/storage\/v1\/object\/public\/tenant-assets\//);
    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0].url).toBe(`/storage/v1/object/upload/sign/tenant-assets/${r.body.path}`);
    expect(storageCalls[0].auth).toBe('Bearer not-a-valid-jwt-postgrest-would-reject-it');
  });

  it('refuses other file types, kinds, unknown tenants, and callers without the ops key', async () => {
    const id = state['acme-burger'].id;
    expect((await upload({ tenantId: id, kind: 'item', contentType: 'image/svg+xml' })).body.error).toBe(
      'unsupported_content_type',
    );
    expect((await upload({ tenantId: id, kind: 'script', contentType: 'image/png' })).body.error).toBe('invalid_kind');
    expect((await upload({ tenantId: '99999999-9999-4999-8999-999999999999', kind: 'logo', contentType: 'image/png' })).status).toBe(404);
    expect((await call(opsAssets, { method: 'POST', body: { tenantId: id, kind: 'logo', contentType: 'image/png' } })).status).toBe(401);
  });
});
