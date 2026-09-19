# 0019 — A tenant can gate its wheel on round score instead of order points

Date: 2026-09-19
Status: Accepted
Migration: `database/migrations/0007_score_gate.sql`

## Context

The wheel has always been gated on ORDER POINTS: survive the round and hold
`wheel_points_threshold` points, which the spin spends. Only a POS webhook
(`api/pos-credit.mjs`) credits those points.

Jimmy's Pizzeria sells through a Zyda storefront and has no POS integration, so
nothing can ever credit a Jimmy's player. Their wheel could not be reached at
all. Players scored 4,000 in the game, saw no prize and no stored progress, and
concluded the backend was not saving anything. The owner chose (2026-09-19)
to let score alone unlock the wheel for such clients.

## Decision

**`settings.wheel_gate` per tenant: `'order_points'` (default) or `'score'`.**

- `resolve_run` gains `p_gate` (default `'order_points'`, so every existing
  caller is unchanged). Under `'score'`, the round's score is measured against
  `p_points_threshold`. Survival is still required, and nothing is spent.
- Anything but an exact `'score'` is treated as order points. The stricter
  rule is the fallback, so a typo can't open a wheel.
- The gate is a **settings row, not a manifest field**. `ops_publish_version`
  rewrites the manifest's rewards block from a reviewed preset on every
  publish, so a gate stored there would silently revert.
  `tenant_published_config` merges it into `manifest.rewards.gate`, so the game
  can word its copy for score before a round is played.
- The existing **win lockout** (`win_lockout_hrs`, enforced by `start_play` per
  phone and device) is the frequency limit. Jimmy's is set to 24 hours: one
  prize per phone per day.
- `submit-run` sends `p_gate` only when the gate is `'score'`, so the API can
  deploy before or after the migration without breaking any tenant.

## Consequences

- **The score is client-reported, and it now pays out.** Under order points
  the score was bragging rights, so its trust level didn't matter. The existing
  defences are the server-issued token, a minimum wall-clock round length
  checked against the token's own timestamp, and `max_plausible_score`. They
  make a forged score cost 30 real seconds, but they don't stop it. Phone
  identity is unverified (ADR 0018), so a script can rotate numbers and collect
  one coupon per number per round. Every coupon is still redeemed in person at
  the counter, which bounds the damage, but this is open real-money exposure.
  A per-tenant daily prize budget, or phone verification, is the fix if it's
  abused.
- The open wheel compliance flag (`docs/security/reward-wheel-compliance.md`)
  applies unchanged. A score-gated wheel is still random weighted odds for
  real-value prizes.
- Order-point tenants (McDonald's) are unaffected. The nine-argument
  `resolve_run` call is covered by `tests/integration/score-gate.test.js`.

## Verification

- `tests/integration/score-gate.test.js` runs the real function under the
  tenant role on embedded Postgres. It checks that a score win pays out and
  spends nothing, that a lockout follows, that a short score or a lost round
  pays nothing, that an unknown gate falls back to order points, that the
  default call keeps the order-points rule, and that the gate appears in the
  public manifest.
- Unit tests cover schema validation, loader passthrough and reward-outcome
  passthrough, plus EN and AR copy.
- Driven in a browser at `/play/jimmys-pizzeria/` with a stubbed backend. A
  3,100 round shows "Score 4,000 or more…" and "3,100 / 4,000". A 4,600 round
  lands a Jimmy's coupon, and the result, wallet and terms screens make no
  mention of order points.
