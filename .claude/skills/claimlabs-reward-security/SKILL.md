---
name: claimlabs-reward-security
description: Required patterns for anything issuing or validating Slice Rush rewards — server-minted codes, verified eligibility, signed sessions, nonces, replay protection, idempotency, atomic budgets, reward ledger, expiry, redemption, audit logs, emergency shutdown. Mandatory reading before touching WHEEL, resolve_run, or api/*.mjs reward paths.
---

# ClaimLabs reward security

## The one rule everything else follows from

**The client never decides a win or mints a reward. It only displays what
the server already decided.** Every pattern below exists to make that rule
actually enforceable, not just stated.

## Patterns already implemented in `mcdonalds/` (verified 2026-08-06 — extend these, don't reinvent)

- **Signed/one-time sessions**: `start-run` issues a `token` (UUID),
  `submit-run` requires it and `resolve_run` marks it used inside the same
  locked transaction (`runs.token_used`, `runs_token_uniq` unique index).
  This is the nonce/replay-protection mechanism — a token can't be
  submitted twice.
- **Atomic budget/points mutation**: `resolve_run` takes `FOR UPDATE` locks
  on the `runs` row and the `players` row before reading/writing
  `order_points` (`supabase/schema.sql` ~lines 385, 401) — this is what
  prevents a race condition draining more budget than intended under
  concurrent requests.
- **Idempotency on external triggers**: `points_ledger_order_uniq` (unique
  index on order ID) stops a retried Foodics webhook from double-crediting.
- **Secrets via constant-time comparison**: `lib/db.mjs`'s `secretEquals`
  (SHA-256 both sides, then `timingSafeEqual`) backs `isAdmin`/
  `isPosCaller` — use this helper for any new secret check, never a plain
  `===`.
- **Plausibility bounds**: `resolve_run` rejects runs outside
  `min_run_ms`/`max_plausible_score` (from the `settings` table, so
  tunable without a redeploy).

## Patterns NOT yet implemented (real gaps, not hypothetical)

- **Redemption ledger / one-time redemption enforcement**: confirm current
  state before assuming it exists — verify against `wheel_wins.redeemed`
  and `redeem_wheel_win` in `supabase/schema.sql` directly rather than
  trusting this list.
- **Expiry**: `DISCOUNT_TIERS`-based codes had a 14-day expiry model in the
  `fastfood-ninja` lineage; the current `mcdonalds` wheel-prize model's
  expiry behavior needs independent verification — don't assume it carried
  over.
- **Audit log**: `admin-*` functions expose read access to players/
  redemptions/engagement; whether there's a genuine immutable audit trail
  (vs. just current-state tables) needs checking before relying on it for
  compliance.
- **Emergency campaign shutdown**: no documented kill-switch for the
  reward wheel/campaign found this session. If a campaign needs to be
  paused fast (budget exhausted, compliance issue), check whether
  `settings` table values can do this today or whether it needs building.
- **Slice-event replay verification**: see `claimlabs-anti-cheat`.

## Standing, unresolved compliance issue

`docs/security/reward-wheel-compliance.md` — the wheel's random-weighted
prize selection for real-value prizes conflicts with this project's own
inherited compliance guidance. Do not treat this skill's "patterns
implemented" list above as meaning the reward system is fully compliant —
technical soundness (locking, idempotency) and legal compliance (is a
random wheel even the right mechanism) are separate questions. This skill
covers the former; the flag file covers the latter.

## Before shipping any reward-path change

Get a `security-adversary` pass (see that agent's specific exploit-attempt
checklist) — reading this skill is not the same as verifying the pattern
was actually applied correctly in a specific diff.
