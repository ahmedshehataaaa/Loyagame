---
name: claimlabs-database
description: Rules for Slice Rush's current Supabase Postgres database — migrations, constraints, indexes, campaign budgets, reward ledger, player identity, test fixtures, backups, rollback. Use for any supabase/schema.sql work or future migration-framework decisions.
---

# ClaimLabs database

## Current state

**One file, no migration framework.** `mcdonalds/supabase/schema.sql`
(681 lines) contains the entire schema — `players`, `points_ledger`,
`runs`, `settings`, `wheel_wins` tables, plus every RPC
(`credit_order_points`, `check_eligibility`, `start_play`, `resolve_run`,
`redeem_wheel_win`, `admin_*`, `client_dashboard`), applied by hand against
Supabase (`create table if not exists` / `create or replace function`
throughout — idempotent-by-convention, not versioned). There is no
`database/migrations/` directory yet despite it being part of the target
architecture.

## Key tables (verified 2026-08-06 — re-check before relying on exact shape)

- **`players`** — identity (phone-keyed) + `order_points` balance.
- **`points_ledger`** — append-only credit history; `points_ledger_order_uniq`
  is the idempotency guard against double-crediting from a retried webhook;
  `apply_ledger_delta()` trigger (line ~65) keeps `players.order_points` in
  sync — don't write to `order_points` directly from a new code path, insert
  into the ledger and let the trigger apply it.
- **`runs`** — one row per game round; `token`/`token_used` implement the
  one-time-session pattern; `runs_token_uniq` enforces it.
- **`wheel_wins`** — prize records, `redeemed` flag for one-time redemption.
- **`settings`** — key/value config read by RPCs at call time
  (`min_run_ms`, `max_plausible_score`, `wheel_points_threshold`,
  `wheel_prizes`, `max_plays`, etc.) — this is how gameplay/reward tuning
  changes without a redeploy; check here before assuming a value is
  hardcoded in `engine/config.js` (that file is the _client mirror/offline
  fallback_, not necessarily the live value).

## Locking pattern — the load-bearing safety mechanism

`resolve_run` and `redeem_wheel_win` both `SELECT ... FOR UPDATE` before
mutating (`supabase/schema.sql` ~lines 385, 401, 447). Any new RPC that
reads-then-writes a shared balance or one-time resource must follow this
exact pattern — a race condition here is a real financial-liability class
of bug (see the `$10,000` prize-ladder note in the inherited design
history), not a theoretical one.

## Player identity

Phone-number-keyed (`normalizePhone`/`normalizeLoosePhone` in `lib/db.mjs`
handle E.164 and loose Foodics-format Egyptian numbers). Any new identity
concept (email, device-only) is a real schema/product decision — flag it,
don't bolt it on as a side effect of an unrelated task.

## Missing (real gaps)

- **No migration framework.** Schema changes are applied by hand,
  untracked. Before this project can safely support multiple environments
  (local/staging/prod) or multiple contributors, introduce one (e.g.
  Supabase CLI migrations, or a minimal numbered-`.sql`-files convention
  under `database/migrations/`) — this is a reasonable first
  implementation task candidate.
- **No seed/fixture data** for local/test use (`database/seeds/`,
  `database/fixtures/` don't exist yet).
- **No documented backup/rollback procedure** — Supabase's own
  point-in-time recovery may cover this, but it isn't written down
  anywhere in this repo; a `docs/runbooks/` entry is worth creating before
  it's needed under pressure.

## Access policy

Per CLAUDE.md: only local/dev or a read-only production connection should
ever be wired up for Claude to use directly. Never configure unrestricted
production write access for an agent. Production schema changes require
explicit human review and approval, run by a human against the real
database — not applied autonomously here.
