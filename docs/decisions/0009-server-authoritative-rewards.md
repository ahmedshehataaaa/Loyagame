# 0009 — Wire the client to the reward backend; close client-side value creation

Date: 2026-08-07
Status: Accepted (Stage 4 of the 2026-08-07 audit — partially complete, see Outstanding)

## Context

Audit finding **S1**, the highest-severity issue in
`docs/audit/2026-08-07-production-readiness-audit.md`: the shipped client
decided rewards entirely in the browser.

- `src/adapters/engine-bridge.js` overwrote `window.LoyaltyData` with a local
  stub whose own comment read _"there is no authoritative backend wired up"_.
  `submitRun()` returned `won: score >= 15000`, computed in the browser.
- Grep confirmed **nothing** in `src/` or `engine/` called `/api/*`. The only
  `fetch` in `src/` was a local function named `fetchStandings()`.
- The Vercel + Supabase backend was therefore **orphaned**: `api/start-run`,
  `api/submit-run` and the row-locked `resolve_run` RPC all existed and were
  correct, but nothing invoked them. The client that used to had been retired
  with `_legacy-ui-backup/data.js`.
- Two further browser-side value paths compounded it: `Store.recordRun()` minted
  `floor(score / 10)` "reward points" into localStorage per round, and
  `Store.redeem()` spent them on real products — a spendable currency created
  and consumed entirely client-side.
- `signin.js` used a `setTimeout` in place of a network call, so a player's
  phone number never reached the backend and no round could be attributed to
  anyone even in principle.

This contradicted `CLAUDE.md`'s "non-negotiable" and `REVIEW.md`. The
2026-08-06 inventory listed server-authoritative resolution as a _"verified
working feature"_; that check had confirmed the backend files exist, not that
the client called them.

## Decision

### A service layer owns all reward communication

```
src/services/
  api.js           transport: timeout, no-store, typed error taxonomy
  reward-state.js  PURE: (round outcome, API result) -> RewardOutcome
  loyalty.js       round session lifecycle, identity, the only API caller
```

Errors are **returned, not thrown**: a flow that must distinguish "the server
said no" from "we never reached the server" cannot use exceptions for one and a
value for the other.

### The invariant, enforced in one place

`reward-state.js` returns a prize **if and only if** the server explicitly said
`won: true` and named a well-formed prize. Every other input — any transport
failure, any unrecognised error kind, `won` as a truthy non-`true` value, a
missing or malformed prize object, a `suspicious` flag, an eliminated round, or
no submission at all — resolves to `prize: null, awarded: false` with a named
status and player-facing copy.

`src/components/reward-panel.js` is the only component permitted to display a
prize, and it can only display `outcome.prize`. It has no fallback copy that
names a product, so a bug elsewhere cannot make a prize appear.

### Round sessions

`/play` calls `startRound()` on mount **and on every restart** — `submit-run`
consumes the token, so a replay reusing the previous one is correctly rejected.
Acquisition is non-blocking: the engine starts immediately and the round is
labelled with whether it can pay out (`.game-stake`), so a player never
discovers only at the end that the round was never rewardable.

`submitRound()` sets a `consumed` flag **synchronously before** its `await`, so
a double-fired round-end event or a concurrent burst yields exactly one request.

### Survival gates the reward, verified server-side

Per ADR 0004 a round is won by surviving it, and only a won round may pay out.
`resolve_run` previously had no survival input at all, so an eliminated player
still spent points and drew a prize. Now:

- `api/submit-run.mjs` **re-derives** survival from the round duration against
  `round_time_sec × survival_tolerance` (new `settings` rows). The request's
  `survived` field is a claim from a browser and is deliberately ignored.
- `resolve_run` gains `p_survived` and gates the prize draw on it, inside the
  same row-locked transaction. The token is still consumed either way — the play
  is spent whether or not the player survived — so a losing round cannot be
  retried for free.
- A survival claim the server's own clock cannot support marks the run
  suspicious.

The old 8-argument `resolve_run` overload is **dropped** so a stale deployment
cannot silently keep resolving runs without the gate. A missing-function error
is loud and fail-closed, which is the correct failure mode for reward code.

### Client-side value creation closed

- `Store.recordRun()` no longer touches `rewardPoints`. Score, best score and
  games played remain local: they are statistics, not value.
- `Store.setOrderPoints()` mirrors the server balance and is the only way it
  moves. It is written **only** by `loyalty.js`, from the response that function
  actually received — an adversarial test proved that letting the screen layer
  write it from the round-result object (which travels through the
  page-scriptable UI bridge) let a forged balance persist to localStorage.
- `Store.redeem()` **fails closed** with `server_required`. It used to decrement
  a localStorage balance and mark a reward owned. Real redemption belongs in
  `redeem_wheel_win()`, which already enforces one-time use atomically. A
  refused redemption is an inconvenience; a browser-granted one is a loss.
- `Store.grantPoints()` (a test helper that incremented the spendable balance)
  is deleted.
- The victory screen's "POINTS EARNED" tile is gone — gameplay earns no points.

### Identity is registered, and honestly labelled

`signin.js` now calls `/register`. The button says **"Continue"**, not "Send
Code": nothing is sent and nothing is verified. `api/register.mjs` trusts the
number as typed by an explicit July 2026 product decision, appending a fraud
flag for review at payout when a number holding points is re-claimed. Promising
a verification step that does not exist was itself a defect.

Guest sign-in **clears** any stored identity, so guest rounds are practice
rounds rather than rounds silently credited to whoever last used the device.

## Consequences

- The rewards catalogue can no longer complete a redemption. Expected and
  intended until Stage 5 wires it to `redeem_wheel_win()`; the UI says
  "redeeming at the counter only" rather than failing opaquely.
- With no backend configured the game stays fully playable and says "Practice
  round", which is the honest degradation.
- `api/*.mjs` and `netlify/functions/*.mjs` were re-synced (they differ only in
  the db import path).
- **`supabase/schema.sql` must be applied by hand before deploy.** Per
  `.claude/rules/database-migrations.md` this is a human action; the new
  `p_survived` signature and the two `settings` rows are required for
  `submit-run` to work at all.

## Verification

**Static:** lint, typecheck (`tsc --checkJs`) and format all clean.

**Unit — 69 tests, +20 this change** (`tests/unit/reward-state.test.js`): the
invariant is proved exhaustively over 9 transport-failure kinds × the denial
paths and 15 hostile/malformed success bodies, not argued.

**Browser — 252 tests across 6 viewports, 3 consecutive clean runs.** The
backend is stubbed at the network boundary with `page.route`, so the real pages,
engine, service layer and store are all exercised:

- `tests/e2e/reward-authority.spec.js` (15) — denial, 500, aborted request,
  malformed body, `won` with no prize, flagged run: **no prize rendered** in any
  of them; an explicit award renders exactly the server's prize. `start-run`
  precedes `submit-run`; the submission carries the server token; one round
  submits once; no identity means no submission at all.
- `tests/e2e/reward-adversarial.spec.js` (15) — `Number.MAX_SAFE_INTEGER`
  score, contradictory survival claims, forged result objects, 5 sequential and
  8 concurrent submissions of one token, stale token after teardown, six hostile
  response bodies including prototype pollution, an alphabet sweep for cheat
  keys, and the dev query params.

**Found and fixed by the adversarial suite:** a forged round-result object
reaching `Store.setOrderPoints` through the UI bridge persisted an
attacker-controlled balance. The service is now the single writer.

## Outstanding — what this change does NOT prove

- **No integration test against a real Supabase instance.** No credentials or
  reachable database exist in this environment, so the server's own guarantees —
  row locking, one-time token consumption, campaign budget, webhook idempotency
  — remain verified only by code reading, exactly as before. This is the single
  biggest remaining gap on the reward path and needs a staging database.
- **The `p_survived` migration is unapplied.** Written, not run.
- **RLS is still unverified** (`docs/audit` §S6).
- **No rate limiting, no emergency campaign shutdown, no audit-log surface** in
  the client-facing path yet.
- **No real OTP.** Unverified identity is a standing product decision, not an
  oversight, but multi-account reward farming remains open. Real verification
  needs an SMS provider and credentials — a product/procurement decision, so it
  is deliberately not invented here.
- A page script can still render a fake prize _in its own browser_ by calling
  the UI bridge directly. Not treated as a vulnerability: no code is issued, the
  audit trail is `wheel_wins`, and the attacker only fools themselves. The test
  asserts the important part — no durable grant.
