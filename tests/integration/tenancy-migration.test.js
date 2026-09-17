import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  asTenant,
  asRole,
  playWinningRound,
  LEGACY_TENANT,
} from './support/stack.js';
import { applyMigrations, listMigrations } from '../../scripts/db-migrate.mjs';

/* Phase 1 pass/fail: "existing McDonald's data migrates with zero data loss".
 *
 * The database is seeded through the PRE-tenancy functions — the ones running in
 * production today — then migrated, and every row of every table is compared
 * value for value. Checking row counts alone would pass a migration that
 * rewrote balances. */

const TABLES = { players: 'id', points_ledger: 'id', runs: 'id', wheel_wins: 'id', settings: 'key' };

async function snapshot(client) {
  const out = {};
  for (const [table, order] of Object.entries(TABLES)) {
    const { rows } = await client.query(
      `select to_jsonb(x) - 'tenant_id' as row from ${table} x order by ${order}`,
    );
    out[table] = rows.map((r) => r.row);
  }
  return out;
}

let stack;
let before;
/** @type {string|null} */
let preTenancyRedeemError = null;

describe('a pre-existing bug the migration fixes', () => {
  it('staff redemption could not run before, and runs after', async () => {
    // Captured in beforeMigrations below, against the unmodified schema.sql.
    expect(preTenancyRedeemError).toMatch(/column reference "prize_label" is ambiguous/);

    const winId = (
      await stack.admin.query('select id from wheel_wins where not redeemed order by id limit 1')
    ).rows[0]?.id;
    if (winId) {
      const r = await asTenant(stack.admin, LEGACY_TENANT, async (c) =>
        (await c.query("select * from redeem_wheel_win($1, 'till-9')", [winId])).rows[0],
      );
      expect(r.ok).toBe(true);
    } else {
      // Only the seeded (already redeemed) win exists: the fixed function must
      // still run and answer, instead of raising.
      const seeded = (await stack.admin.query('select id from wheel_wins order by id limit 1')).rows[0].id;
      const r = await asTenant(stack.admin, LEGACY_TENANT, async (c) =>
        (await c.query("select * from redeem_wheel_win($1, 'till-9')", [seeded])).rows[0],
      );
      expect(r).toMatchObject({ ok: false, error: 'already_redeemed' });
    }
  });
});

beforeAll(async () => {
  stack = await startStack({
    beforeMigrations: async (c) => {
      await c.query(
        "select * from credit_order_points('+201001110001', 'FOODICS-1', 5200, 'foodics', null, 520)",
      );
      await c.query(
        "select * from credit_order_points('+201001110002', 'FOODICS-2', 900, 'foodics', null, 90)",
      );
      await c.query(
        "select * from credit_order_points('+201001110002', null, 100, 'manual', 'goodwill', null)",
      );

      const grant = (
        await c.query(
          "select * from start_play('+201001110001', '+20', 'device-a', 24, 999999, 12, '2026-09')",
        )
      ).rows[0];
      await c.query("update runs set created_at = now() - interval '40 seconds' where token = $1", [
        grant.token,
      ]);
      const prizes = (await c.query("select value from settings where key = 'wheel_prizes'")).rows[0]
        .value;
      const won = (
        await c.query(
          "select * from resolve_run($1, 1800, 31000, 'device-a', 4000, 5000, 2000000, $2, true)",
          [grant.token, JSON.stringify(prizes)],
        )
      ).rows[0];
      if (!won.won) throw new Error('seed round did not win');
      const win = (await c.query('select id from wheel_wins limit 1')).rows[0];
      /* The pre-tenancy redeem_wheel_win cannot run at all: its OUT parameter
         `prize_label` collides with the column of the same name, and Postgres
         rejects the RETURNING clause as ambiguous. Recorded here so the fix in
         0003 is proved against the real before-state, then the redemption is
         seeded directly, the way no production call could have made it. */
      // Autocommit: the failed statement leaves nothing behind to roll back.
      preTenancyRedeemError = await c
        .query("select * from redeem_wheel_win($1, 'till-3')", [win.id])
        .then(() => null, (err) => err.message);
      await c.query(
        "update wheel_wins set redeemed = true, redeemed_at = now(), redeemed_by = 'till-3' where id = $1",
        [win.id],
      );

      // An abandoned round and a flagged player, so every column shape is present.
      await c.query(
        "select * from start_play('+201001110002', '+20', 'device-b', 24, 999999, 12, '2026-09')",
      );
      await c.query(
        `update players set flags = '[{"type":"reclaim","at":"2026-09-01T00:00:00Z","note":"seed"}]'
          where phone = '+201001110002'`,
      );

      before = await snapshot(c);
    },
  });
});

afterAll(async () => {
  await stack?.stop();
});

describe('migrating the live single-tenant database', () => {
  it('applies every migration, in order', () => {
    expect(stack.applied).toEqual(listMigrations().map((m) => m.name));
  });

  it('seeded real history to migrate', () => {
    expect(before.players).toHaveLength(2);
    expect(before.points_ledger.length).toBeGreaterThanOrEqual(4); // 3 credits + 1 wheel spend
    expect(before.runs).toHaveLength(2);
    expect(before.wheel_wins).toHaveLength(1);
    expect(before.settings.length).toBeGreaterThan(5);
  });

  it('keeps every row and every value', async () => {
    expect(await snapshot(stack.admin)).toEqual(before);
  });

  it("tags every existing row as McDonald's", async () => {
    for (const table of Object.keys(TABLES)) {
      const { rows } = await stack.admin.query(
        `select count(*)::int as n from ${table} where tenant_id is distinct from $1`,
        [LEGACY_TENANT],
      );
      expect(rows[0].n, table).toBe(0);
    }
    const { rows } = await stack.admin.query('select slug, status, coupon_prefix from tenants');
    expect(rows).toEqual([{ slug: 'mcdonalds', status: 'active', coupon_prefix: 'MC' }]);
  });

  it('replaces the global keys with tenant-aware ones', async () => {
    const { rows } = await stack.admin.query(
      "select conname from pg_constraint where connamespace = 'public'::regnamespace",
    );
    const names = rows.map((r) => r.conname);
    expect(names).not.toContain('players_phone_key');
    expect(names).not.toContain('points_ledger_player_id_fkey');
    expect(names).toEqual(
      expect.arrayContaining([
        'players_tenant_phone_key',
        'points_ledger_tenant_player_fkey',
        'runs_tenant_player_fkey',
        'wheel_wins_tenant_player_fkey',
      ]),
    );
  });
});

describe('the migration record', () => {
  it('does not re-apply anything', async () => {
    expect(await applyMigrations(stack.admin, { log: () => {} })).toEqual([]);
  });

  it('refuses an applied migration whose file was edited afterwards', async () => {
    const first = listMigrations()[0];
    await stack.admin.query("update claimlabs_migrations set checksum = 'edited' where name = $1", [
      first.name,
    ]);
    try {
      await expect(applyMigrations(stack.admin, { log: () => {} })).rejects.toThrow(
        /different checksum/,
      );
    } finally {
      await stack.admin.query('update claimlabs_migrations set checksum = $2 where name = $1', [
        first.name,
        first.checksum,
      ]);
    }
  });
});

describe("McDonald's keeps working after the migration", () => {
  it('a replayed POS order is still recognised as a duplicate', async () => {
    const r = await asTenant(stack.admin, LEGACY_TENANT, async (c) =>
      (
        await c.query(
          "select * from credit_order_points('+201001110001', 'FOODICS-1', 5200, 'foodics', null, 520)",
        )
      ).rows[0],
    );
    expect(r.duplicate).toBe(true);
  });

  it('a migrated player can earn, play and win through the tenant role', async () => {
    await asTenant(stack.admin, LEGACY_TENANT, (c) =>
      c.query("select * from credit_order_points('+201001110002', 'FOODICS-3', 4000, 'foodics', null, 400)"),
    );
    const r = await playWinningRound(stack.admin, LEGACY_TENANT, {
      phone: '+201001110002',
      device: 'device-b',
    });
    expect(r.won).toBe(true);
    // Same prefix as before the migration: McDonald's codes do not change shape.
    expect(r.code).toMatch(/^MC-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r.order_points).toBe(1000); // 900 + 100 + 4000 earned, 4000 spent
  });

  it('a deployment still on the service key keeps serving McDonald’s during the rollout', async () => {
    const r = await asRole(stack.admin, 'service_role', null, async (c) =>
      (
        await c.query(
          "select * from start_play('+201001110099', '+20', 'device-z', 24, 999999, 12, '2026-09')",
        )
      ).rows[0],
    );
    expect(r.ok).toBe(true);
    const { rows } = await stack.admin.query('select tenant_id from runs where token = $1', [r.token]);
    expect(rows[0].tenant_id).toBe(LEGACY_TENANT);
  });
});
