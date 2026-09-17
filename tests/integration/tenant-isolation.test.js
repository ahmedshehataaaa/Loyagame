import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  asTenant,
  asOps,
  asRole,
  onboardTenant,
  playWinningRound,
  LEGACY_TENANT,
} from './support/stack.js';

/* Phase 1 pass/fail: "RLS policies block cross-tenant reads in a test query".
 *
 * Two brands share a customer (same phone) and a POS order id — the realistic
 * overlap, and the one most likely to expose a missed tenant predicate. Every
 * assertion runs under the database role and JWT claims PostgREST would set,
 * so what is proved is the database boundary itself, not the API's good
 * behaviour on top of it. */

const SHARED = '+201009990000';
const A_ONLY = '+201001111111';
const B_ONLY = '+201002222222';

let stack;
let A;
let B;
let bWinId;

const scalar = async (c, sql, params = []) => Object.values((await c.query(sql, params)).rows[0])[0];

beforeAll(async () => {
  stack = await startStack();
  A = await onboardTenant(stack.admin, { slug: 'acme-burger', name: 'Acme Burger', prefix: 'AB' });
  B = await onboardTenant(stack.admin, { slug: 'nile-cafe', name: 'Nile Cafe', prefix: 'NC' });

  for (const [tenant, only] of [
    [A, A_ONLY],
    [B, B_ONLY],
  ]) {
    await asTenant(stack.admin, tenant.id, async (c) => {
      await c.query(
        "select * from credit_order_points($1, 'ORDER-SHARED', 9000, 'foodics', null, 900)",
        [SHARED],
      );
      await c.query(
        "select * from credit_order_points($1, $2, 9000, 'foodics', null, 900)",
        [only, `ORDER-${only}`],
      );
    });
  }

  const aWin = await playWinningRound(stack.admin, A.id, { phone: SHARED, device: 'device-shared' });
  const bWin = await playWinningRound(stack.admin, B.id, { phone: B_ONLY, device: 'device-b' });
  if (!aWin.won || !bWin.won) throw new Error('fixture rounds did not win');
  bWinId = await scalar(stack.admin, 'select id from wheel_wins where tenant_id = $1', [B.id]);
});

afterAll(async () => {
  await stack?.stop();
});

describe('reads', () => {
  for (const table of ['players', 'points_ledger', 'runs', 'wheel_wins', 'settings']) {
    it(`${table}: tenant A sees exactly its own rows`, async () => {
      const expected = await scalar(
        stack.admin,
        `select count(*)::int from ${table} where tenant_id = $1`,
        [A.id],
      );
      const rows = await asTenant(stack.admin, A.id, async (c) =>
        (await c.query(`select tenant_id from ${table}`)).rows,
      );
      expect(expected).toBeGreaterThan(0);
      expect(rows).toHaveLength(expected);
      expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([A.id]));
    });
  }

  it('a filter naming the other tenant returns nothing, rather than an error that confirms it exists', async () => {
    const rows = await asTenant(stack.admin, A.id, async (c) =>
      (await c.query('select * from players where tenant_id = $1', [B.id])).rows,
    );
    expect(rows).toEqual([]);
  });

  it('the same phone is two separate players with separate balances', async () => {
    const { rows } = await stack.admin.query(
      'select tenant_id, order_points from players where phone = $1 order by order_points',
      [SHARED],
    );
    expect(rows).toEqual([
      { tenant_id: A.id, order_points: 5000 }, // won once: 9000 - 4000
      { tenant_id: B.id, order_points: 9000 },
    ]);
  });

  it('a tenant sees only its own tenant row', async () => {
    const rows = await asTenant(stack.admin, A.id, async (c) =>
      (await c.query('select slug from tenants')).rows,
    );
    expect(rows).toEqual([{ slug: 'acme-burger' }]);
  });
});

describe('writes', () => {
  it("cannot insert a row into another tenant's data", async () => {
    await expect(
      asTenant(stack.admin, A.id, (c) =>
        c.query("insert into players (tenant_id, phone) values ($1, '+201234567890')", [B.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("an insert that omits tenant_id lands in the caller's tenant", async () => {
    const row = await asTenant(stack.admin, A.id, async (c) =>
      (await c.query("insert into players (phone) values ('+201230000001') returning tenant_id")).rows[0],
    );
    expect(row.tenant_id).toBe(A.id);
  });

  it("cannot update another tenant's rows — they are simply not there", async () => {
    const res = await asTenant(stack.admin, A.id, (c) =>
      c.query(`update players set flags = '[{"type":"x"}]' where tenant_id = $1`, [B.id]),
    );
    expect(res.rowCount).toBe(0);
    expect(
      await scalar(stack.admin, "select count(*)::int from players where tenant_id = $1 and flags <> '[]'", [
        B.id,
      ]),
    ).toBe(0);
  });

  it('cannot move its own row into another tenant', async () => {
    await expect(
      asTenant(stack.admin, A.id, (c) =>
        c.query('update players set tenant_id = $1 where phone = $2', [B.id, A_ONLY]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('the same POS order id is independent per brand', async () => {
    expect(
      await scalar(stack.admin, "select count(*)::int from points_ledger where order_id = 'ORDER-SHARED'"),
    ).toBe(2);
  });
});

describe('reward paths', () => {
  it("cannot resolve another tenant's round token", async () => {
    const token = await asTenant(stack.admin, B.id, async (c) =>
      (await c.query("select * from start_play($1, '+20', 'device-x', 24, 999999, 12, '2026-09')", [SHARED]))
        .rows[0].token,
    );
    const r = await asTenant(stack.admin, A.id, async (c) =>
      (
        await c.query(
          "select * from resolve_run($1, 1000, 31000, 'device-x', 4000, 5000, 2000000, '[]'::jsonb, true)",
          [token],
        )
      ).rows[0],
    );
    expect(r.ok).toBe(false);
    expect(await scalar(stack.admin, 'select token_used from runs where token = $1', [token])).toBe(false);
  });

  it("cannot redeem another tenant's coupon by guessing its id", async () => {
    const r = await asTenant(stack.admin, A.id, async (c) =>
      (await c.query("select * from redeem_wheel_win($1, 'till-1')", [bWinId])).rows[0],
    );
    expect(r).toMatchObject({ ok: false, error: 'not_found' });
    expect(await scalar(stack.admin, 'select redeemed from wheel_wins where id = $1', [bWinId])).toBe(false);
  });

  it('a tenant redeems its own coupon exactly once', async () => {
    const redeem = () =>
      asTenant(stack.admin, B.id, async (c) =>
        (await c.query("select * from redeem_wheel_win($1, 'till-2')", [bWinId])).rows[0],
      );
    expect(await redeem()).toMatchObject({ ok: true, error: null });
    expect(await redeem()).toMatchObject({ ok: false, error: 'already_redeemed' });
  });

  it("coupon codes carry each tenant's prefix", async () => {
    const { rows } = await stack.admin.query(
      'select t.coupon_prefix, w.code from wheel_wins w join tenants t on t.id = w.tenant_id',
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.code.startsWith(`${r.coupon_prefix}-`)).toBe(true);
  });

  it('a win at one brand does not lock the same phone out of another', async () => {
    const at = (tenant) =>
      asTenant(stack.admin, tenant.id, async (c) =>
        (await c.query("select * from check_eligibility($1, 'device-shared', 24, 999999, 12)", [SHARED]))
          .rows[0],
      );
    expect((await at(A)).reason).toBe('locked_win');
    expect((await at(B)).eligible).toBe(true);
  });

  it("each tenant draws from its own published prize table", async () => {
    const prizes = (tenant) =>
      asTenant(stack.admin, tenant.id, async (c) =>
        (await c.query("select value from settings where key = 'wheel_prizes'")).rows,
      );
    const [a, b] = [await prizes(A), await prizes(B)];
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('reporting functions never include another tenant', () => {
  it('admin and client dashboards, player lists, redemptions and engagement', async () => {
    const out = await asTenant(stack.admin, A.id, async (c) => {
      const q = async (sql, params = []) => Object.values((await c.query(sql, params)).rows[0])[0];
      return {
        dashboard: await q('select admin_dashboard()'),
        players: await q('select admin_players_list(null, 100, 0)'),
        detailOfB: await q('select admin_player_detail($1)', [B_ONLY]),
        redemptions: await q('select admin_redemptions(null, null, 100, 0)'),
        engagement: await q('select admin_engagement(14)'),
        client: await q("select client_dashboard(now() - interval '30 days', now() + interval '1 day')"),
      };
    });

    expect(JSON.stringify(out)).not.toContain(B_ONLY);
    expect(out.detailOfB).toBeNull();
    expect(out.dashboard.players.total).toBe(3); // SHARED, A_ONLY, and the row inserted above
    expect(out.dashboard.wheel.winsTotal).toBe(1);
    expect(out.players.total).toBe(3);
    expect(out.redemptions.total).toBe(1);
    expect(out.client.orders).toBe(2);
    expect(out.engagement.dropOff.started).toBe(
      await scalar(stack.admin, 'select count(*)::int from runs where tenant_id = $1', [A.id]),
    );
  });
});

describe('a request with no valid tenant is refused', () => {
  it('no tenant claim: money paths raise, reads see nothing', async () => {
    const claims = { role: 'app_tenant' };
    await expect(
      asRole(stack.admin, 'app_tenant', claims, (c) =>
        c.query("select * from start_play($1, '+20', 'd', 24, 999999, 12, '2026-09')", [SHARED]),
      ),
    ).rejects.toThrow(/tenant_required/);
    const rows = await asRole(stack.admin, 'app_tenant', claims, async (c) =>
      (await c.query('select * from players')).rows,
    );
    expect(rows).toEqual([]);
  });

  it('a malformed tenant claim fails closed', async () => {
    await expect(
      asRole(stack.admin, 'app_tenant', { tenant_id: 'not-a-uuid' }, (c) => c.query('select * from players')),
    ).rejects.toThrow();
  });

  it('a paused tenant cannot start or pay a round, but its tills and reports keep working', async () => {
    await asOps(stack.admin, (c) => c.query("select ops_set_tenant_status($1, 'paused', 'Nour Adel')", [B.id]));
    try {
      await expect(
        asTenant(stack.admin, B.id, (c) =>
          c.query("select * from start_play($1, '+20', 'd', 24, 999999, 12, '2026-09')", [SHARED]),
        ),
      ).rejects.toThrow(/tenant_inactive/);
      const credit = await asTenant(stack.admin, B.id, async (c) =>
        (await c.query("select * from credit_order_points($1, 'ORDER-PAUSED', 10, 'foodics', null, 1)", [SHARED]))
          .rows[0],
      );
      expect(credit.duplicate).toBe(false);
      await expect(asTenant(stack.admin, B.id, (c) => c.query('select admin_dashboard()'))).resolves.toBeTruthy();
    } finally {
      await asOps(stack.admin, (c) => c.query("select ops_set_tenant_status($1, 'active', 'Nour Adel')", [B.id]));
    }
  });
});

describe('roles can do only their own job', () => {
  it('anon (the public API key) reaches no table and no function', async () => {
    for (const sql of [
      'select * from players',
      'select * from tenants',
      'select admin_dashboard()',
      "select * from resolve_tenant('acme-burger')",
      'select ops_overview()',
    ]) {
      await expect(asRole(stack.admin, 'anon', null, (c) => c.query(sql)), sql).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('tenant_resolver can look a tenant up and read its published config, nothing else', async () => {
    const found = await asRole(stack.admin, 'tenant_resolver', { role: 'tenant_resolver' }, async (c) => ({
      tenant: (await c.query("select * from resolve_tenant('acme-burger')")).rows[0],
      config: (await c.query("select tenant_published_config('nile-cafe') as c")).rows[0].c,
    }));
    // Publishing does not activate: a new tenant stays in trial until ops says otherwise.
    expect(found.tenant).toMatchObject({ id: A.id, published: true, status: 'trial' });
    expect(found.config.manifest.brand.id).toBe('nile-cafe');

    for (const sql of ['select * from players', 'select ops_overview()', 'select admin_dashboard()']) {
      await expect(
        asRole(stack.admin, 'tenant_resolver', { role: 'tenant_resolver' }, (c) => c.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('a tenant token cannot reach ops functions or config history', async () => {
    for (const sql of [
      'select ops_overview()',
      "select ops_tenant_detail('nile-cafe')",
      'select * from tenant_config_versions',
      "select ops_review_preset('standard-10', 'x')",
    ]) {
      await expect(asTenant(stack.admin, A.id, (c) => c.query(sql)), sql).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('an ops token cannot play or pay a round', async () => {
    await expect(
      asOps(stack.admin, (c) =>
        c.query("select * from start_play($1, '+20', 'd', 24, 999999, 12, '2026-09')", [SHARED]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('the ops overview sees every tenant', async () => {
    const overview = await asOps(stack.admin, async (c) => (await c.query('select ops_overview() as o')).rows[0].o);
    const bySlug = Object.fromEntries(overview.map((t) => [t.slug, t]));
    expect(Object.keys(bySlug).sort()).toEqual(['acme-burger', 'mcdonalds', 'nile-cafe']);
    expect(bySlug['acme-burger'].wins7d).toBe(1);
    expect(bySlug['nile-cafe'].wins7d).toBe(1);
    expect(bySlug.mcdonalds.id).toBe(LEGACY_TENANT);
  });
});

describe('brand asset storage', () => {
  const insertObject = (tenantId, name) =>
    asRole(stack.admin, 'ops_admin', { role: 'ops_admin', tenant_id: tenantId }, (c) =>
      c.query("insert into storage.objects (bucket_id, name) values ('tenant-assets', $1)", [name]),
    );

  it("an ops token scoped to a tenant writes only under that tenant's folder", async () => {
    await expect(insertObject(A.id, `${A.id}/logo/logo.png`)).resolves.toBeTruthy();
    await expect(insertObject(A.id, `${B.id}/logo/logo.png`)).rejects.toThrow(/row-level security/);
    await expect(insertObject(A.id, 'logo.png')).rejects.toThrow(/row-level security/);
  });

  it('a tenant token cannot write assets at all', async () => {
    await expect(
      asTenant(stack.admin, A.id, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ('tenant-assets', $1)", [
          `${A.id}/logo/x.png`,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
