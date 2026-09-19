import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, asTenant, onboardTenant } from './support/stack.js';

/* Migration 0007: a tenant can gate its wheel on the ROUND SCORE instead of an
 * order-points balance. Proved against real Postgres under the tenant role,
 * because what matters is exactly what a mock would fake: that a score-gated
 * win spends nothing, that a short score or a lost round still pays nothing,
 * that an unrecognised gate falls back to the stricter rule, and that the
 * existing win lockout is what stops the same phone winning again. */

let stack;
let T;
let prizes;

const PHONE = '+201005550001';

/** Start a round, backdate it, and resolve it with the given score and gate. */
async function round(phone, device, { score, gate, survived = true }) {
  const grant = await asTenant(stack.admin, T.id, async (c) => {
    const { rows } = await c.query(
      "select * from start_play($1, '+20', $2, 24, 999999, 24, '2026-09')",
      [phone, device],
    );
    return rows[0];
  });
  if (!grant.token) return { granted: false, reason: grant.reason };
  await stack.admin.query(
    "update runs set created_at = now() - interval '40 seconds' where token = $1",
    [grant.token],
  );
  return asTenant(stack.admin, T.id, async (c) => {
    const { rows } = await c.query(
      'select * from resolve_run($1, $2, 31000, $3, 4000, 5000, 2000000, $4, $5, $6)',
      [grant.token, score, device, JSON.stringify(prizes), survived, gate],
    );
    return { granted: true, ...rows[0] };
  });
}

const balance = async (phone) =>
  asTenant(stack.admin, T.id, async (c) => {
    const { rows } = await c.query('select order_points from players where phone = $1', [phone]);
    return rows[0]?.order_points ?? 0;
  });

beforeAll(async () => {
  stack = await startStack();
  T = await onboardTenant(stack.admin, { slug: 'score-pizza', name: 'Score Pizza', prefix: 'SP' });
  prizes = (
    await stack.admin.query(
      "select value from settings where tenant_id = $1 and key = 'wheel_prizes'",
      [T.id],
    )
  ).rows[0].value;
});

afterAll(async () => {
  await stack?.stop();
});

describe('score gate (0007)', () => {
  it('pays out a survived round that reaches the score, spending no order points', async () => {
    const r = await round(PHONE, 'dev-1', { score: 4200, gate: 'score' });
    expect(r.won).toBe(true);
    // Same shape and alphabet as before 0008: no 0/O/1/I, two groups of four.
    expect(r.code).toMatch(/^SP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(await balance(PHONE)).toBe(0);
    const ledger = await stack.admin.query(
      "select count(*)::int n from points_ledger where tenant_id = $1 and reason = 'wheel_spend'",
      [T.id],
    );
    expect(ledger.rows[0].n).toBe(0);
  });

  it('locks the winner out, so the same phone cannot collect again straight away', async () => {
    const r = await round(PHONE, 'dev-1', { score: 9000, gate: 'score' });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('locked_win');
  });

  it('pays nothing below the score, and reports the gap in score terms', async () => {
    const r = await round('+201005550002', 'dev-2', { score: 3100, gate: 'score' });
    expect(r.won).toBe(false);
    expect(r.gap).toBe(900);
  });

  it('pays nothing for a round that was not survived, whatever the score', async () => {
    const r = await round('+201005550003', 'dev-3', {
      score: 8000,
      gate: 'score',
      survived: false,
    });
    expect(r.won).toBe(false);
  });

  it('treats an unknown gate as order points: a high score alone opens nothing', async () => {
    const r = await round('+201005550004', 'dev-4', { score: 8000, gate: 'anything' });
    expect(r.won).toBe(false);
    expect(r.gap).toBe(4000);
  });

  it('leaves the order-points rule unchanged when the gate is omitted', async () => {
    const phone = '+201005550005';
    await asTenant(stack.admin, T.id, (c) =>
      c.query("select * from credit_order_points($1, 'ORD-5', 4500, 'foodics', null, 450)", [
        phone,
      ]),
    );
    const grant = await asTenant(stack.admin, T.id, async (c) => {
      const { rows } = await c.query(
        "select * from start_play($1, '+20', 'dev-5', 24, 999999, 24, '2026-09')",
        [phone],
      );
      return rows[0];
    });
    await stack.admin.query(
      "update runs set created_at = now() - interval '40 seconds' where token = $1",
      [grant.token],
    );
    // The nine-argument call every pre-0007 caller makes.
    const r = await asTenant(stack.admin, T.id, async (c) => {
      const { rows } = await c.query(
        "select * from resolve_run($1, 100, 31000, 'dev-5', 4000, 5000, 2000000, $2, true)",
        [grant.token, JSON.stringify(prizes)],
      );
      return rows[0];
    });
    expect(r.won).toBe(true);
    expect(await balance(phone)).toBe(500);
  });

  it('publishes the settings gate in the public manifest', async () => {
    const gateOf = async () =>
      (await stack.admin.query('select tenant_published_config($1) as c', ['score-pizza'])).rows[0]
        .c.manifest.rewards.gate;
    expect(await gateOf()).toBe('order_points');
    await stack.admin.query(
      "insert into settings (tenant_id, key, value) values ($1, 'wheel_gate', '\"score\"')",
      [T.id],
    );
    expect(await gateOf()).toBe('score');
  });
});
