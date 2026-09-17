# Multi-tenant admin system — Phase 0 migration plan

Status: **signed off 2026-09-15 and implemented 2026-09-16 — see ADR 0018 and the PROGRESS.md checkpoint.** Decisions: D1 no OTP · D2 new ops dashboard (`Desktop/claimlabs-ops`) · D3 `dev` off `main`, work on `feature/multi-tenant` · D4 enum only, creation refused · D5 migration run by a human · D6 reviewed presets only · D7 `/play/<slug>`.
Source brief: `Downloads/claimlabs-multitenant-dashboard-prompt.md`.
Repos read: this repo (`Loyagame`, branch `fix/viewport-leaderboard-ui`) and
`Desktop/claimlabs-dashboard` (`master`, no remote).

---

## 1. The brief vs. what actually exists

The brief was written against an older picture of the stack. Several of its
premises are wrong, and three of them change the plan materially.

| Brief says | Repo reality | Effect on plan |
|---|---|---|
| Phaser engine | Vanilla Canvas 2D (`engine/game.js`) + ES-module shell. No Phaser anywhere. | Phase 4 extends the existing campaign loader; nothing to port. |
| Node/Express + **SQLite** | Vercel Functions (`api/*.mjs`, mirrored in `netlify/functions/`) → **Supabase Postgres already**, via raw PostgREST. No SQLite, no Express. | "Migrate SQLite → Supabase" is already done. Phase 1 becomes *add tenancy to the existing Postgres schema*. |
| Schema: users, OTP codes, sessions, points ledger, game sessions, coupons, competition entries | `players`, `points_ledger`, `runs` (= game sessions + round tokens), `wheel_wins` (= coupons), `settings`. No OTP or session tables. Competition tables were **dropped** July 2026. | Schema diff below is against the real five tables. |
| **"Phone numbers are OTP-verified before any reward issuance"** (non-negotiable) | Identity is **deliberately unverified** — `api/register.mjs`: "Identity is UNVERIFIED by design (user decision July 2026)". No OTP exists. | **Decision D1.** Contradicts a recorded owner decision; cannot be silently "restored". |
| "Enforce isolation with RLS keyed on tenant_id" | Every function calls PostgREST with `SUPABASE_SERVICE_KEY`, and **the service role bypasses RLS**. RLS is enabled today with zero policies. | RLS on `tenant_id` alone would isolate nothing on the real code path. See §3 — requires a non-bypass DB role. |
| Extend "the existing Next.js dashboard" with SWR/React Query | `claimlabs-dashboard` is Next 16 + shadcn (**Base UI**, not Radix) + Recharts. **Brand-facing**, not an ops tool. No SWR/React Query, no auth, no git remote, no Playwright. A *second*, different React dashboard lives on remote branch `claude/mcdonalds-dashboard-backend-afnn7g`. | **Decision D2.** |
| Git: `main → dev → feature`, PR + 1 approval | Only `main` exists. No `dev`. Current branch `fix/viewport-leaderboard-ui` is 5 commits ahead of `main`, unmerged. | **Decision D3.** |
| `game_format: slice_rush \| catch_fries` | Catch the Fries has no code in any repo. `CLAUDE.md` forbids building or referencing it unless explicitly told to. | Enum value only; selecting it in the wizard is disabled. **Decision D4.** |
| McDonald's data must migrate with zero loss | `CLAUDE.md`: "There is no reachable Supabase instance" — server guarantees are untested. Whether live McDonald's rows exist is unknown. | **Decision D5.** |

Other findings that affect the migration:

- **`settings.wheel_prizes` in `schema.sql` still seeds Krispy Kreme prizes**
  ("Free Original Glazed", "Free dozen"), while `campaigns/mcdonalds.json`
  holds McDonald's prizes. `submit-run.mjs` draws from **settings**, not the
  manifest. If the live DB was never corrected, McDonald's players are winning
  Krispy Kreme labels. Must be checked against the live row before backfill.
- Coupon prefix `'MC'` is hard-coded inside `resolve_run`.
- `redeem_wheel_win(p_win_id)` looks a win up **by numeric id alone**. Across
  tenants that means staff at brand A could redeem brand B's coupon by guessing
  a sequential id. Must become tenant-scoped.
- `check_eligibility` locks out by `phone OR device` globally — a win at one
  brand would lock the same phone out at every other brand.
- `ADMIN_KEY` and `FOODICS_WEBHOOK_SECRET` are single global secrets. The POS
  webhook has no way to say which tenant an order belongs to.
- ADR 0012 (campaign manifests) is referenced everywhere but **the file does not
  exist**. ADR number 0017 is used twice (local vs. the remote dashboard branch).
- The reward wheel's **open compliance flag** (`docs/security/reward-wheel-compliance.md`)
  gets worse under this brief: the wizard would let staff set real-money prize
  odds per client with no code review. See D6.

## 2. Schema diff

Delivered as numbered, additive files under `database/migrations/` (the target
layout in `.claude/rules/database-migrations.md`) rather than appended to
`supabase/schema.sql`. Applied by a human, never by the agent, against prod.

**New**

```sql
create type tenant_status as enum ('trial','active','paused','archived');
create type game_format   as enum ('slice_rush','catch_fries');

create table tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9](-?[a-z0-9])*$'),
  status        tenant_status not null default 'trial',
  game_format   game_format  not null default 'slice_rush',
  brand_config  jsonb not null,          -- published manifest (campaigns/schema.js shape)
  coupon_prefix text not null check (coupon_prefix ~ '^[A-Z]{2,4}$'),
  pos_secret_hash text,                  -- sha256 of per-tenant Foodics secret
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Draft → preview → publish, and an audit trail for prize-odds changes.
create table tenant_config_versions (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references tenants(id),
  manifest     jsonb not null,
  state        text not null check (state in ('draft','published','superseded')),
  created_by   text not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
```

**Changed — every tenant-scoped table**

| Table | Add | Uniqueness / integrity change |
|---|---|---|
| `players` | `tenant_id uuid not null` | `unique(phone)` → `unique(tenant_id, phone)`; add `unique(tenant_id, id)` as composite FK target |
| `points_ledger` | `tenant_id` | FK `(tenant_id, player_id) → players(tenant_id, id)`; order idempotency index → `(tenant_id, order_id)` |
| `runs` | `tenant_id` | composite FK to players; `token` stays globally unique |
| `wheel_wins` | `tenant_id` | composite FK to players; `code` stays **globally** unique (bearer token) |
| `settings` | `tenant_id` | PK `key` → PK `(tenant_id, key)` |

Composite FKs make a cross-tenant row link impossible even from buggy code,
not merely filtered. All indexes are rebuilt leading with `tenant_id`.

**Backfill (single transaction):** insert the `mcdonalds` tenant → record
`count(*)` + a checksum per table → `update … set tenant_id` → `set not null` →
re-count and compare. Any mismatch aborts the transaction.

**RPCs rewritten to be tenant-scoped** (tenant read from the request's JWT
claim via a `current_tenant()` helper — never from a caller-supplied argument):
`credit_order_points`, `check_eligibility`, `start_play`, `resolve_run`,
`mint_coupon_code` (prefix from `tenants`), `redeem_wheel_win`,
`admin_dashboard`, `admin_players_list`, `admin_player_detail`,
`admin_redemptions`, `admin_engagement`, `client_dashboard`, and the
`apply_ledger_delta` trigger. Row-lock (`FOR UPDATE`) discipline is unchanged;
the reward logic itself is not edited beyond adding the tenant predicate.

## 3. Isolation model and RLS policy list

Because the service role bypasses RLS, isolation needs a role that does not:

- **`app_tenant`** — Postgres role with no `BYPASSRLS`. The functions stop using
  the service key for request traffic and call PostgREST with a short-lived JWT
  carrying `role: app_tenant` and a `tenant_id` claim, minted server-side per
  request after resolving the tenant. RPCs stay `SECURITY INVOKER`, so RLS
  applies inside them. (Verify the Supabase project's JWT signing setup
  supports server-minted tokens before Phase 1 — this is the one piece of the
  design that depends on project configuration.)
- **`ops_admin`** — same mechanism, for ClaimLabs staff; read-all for the
  cross-tenant view, writes only through tenant CRUD RPCs.
- **Service key** — kept only for migrations and the tenant-creation RPC.

| Object | Role | Policy |
|---|---|---|
| `players`, `points_ledger`, `runs`, `wheel_wins`, `settings` | `app_tenant` | `select/insert/update`: `tenant_id = current_tenant()`; `with check` the same. No `delete`. |
| same five | `ops_admin` | `select`: `true` (aggregate ops view). No direct writes. |
| `tenants` | `app_tenant` | `select`: `id = current_tenant() and status in ('trial','active')` |
| `tenants`, `tenant_config_versions` | `ops_admin` | `select/insert/update`: `true` |
| all of the above | `anon`, `authenticated` | no policies (deny) — unchanged from today |
| `storage.objects` bucket `tenant-assets` | `ops_admin` | `insert/update/delete` where `(storage.foldername(name))[1] = <tenant id>` |
| same bucket | public | `select` — sprites and logos are loaded by players' browsers, so they are public by nature. "Retrievable only within tenant scope" is enforced for **writes and listing**, not reads. |

Phase 1's pass/fail "RLS blocks cross-tenant reads in a test query" becomes a
concrete integration test: JWT for tenant A, `select * from players`, assert
zero rows belonging to tenant B, for every table and every RPC.

## 4. Files that change, by phase

Scope locks from the brief are enforced by path: **`engine/**` and `src/game/**`
are not touched in any phase.**

**Phase 1 — tenancy in Postgres** (this repo)
- `database/migrations/0001_tenants.sql`, `0002_tenant_columns_backfill.sql`,
  `0003_tenant_rpcs.sql`, `0004_rls_policies.sql` — new
- `supabase/config.toml` + `tests/integration/rls-isolation.test.js` — new;
  needs a local Supabase (Docker) because none is reachable today
- `docs/decisions/0018-multi-tenancy.md`; backfill the missing ADR 0012

**Phase 2 — tenant CRUD + asset API** (this repo)
- `lib/db.mjs` and `netlify/functions/_lib/db.mjs` — tenant resolution, JWT
  minting, tenant-aware `sb()`/`rpc()`/`getSettings()`
- all 12 `api/*.mjs` **and** their 12 `netlify/functions/*.mjs` mirrors — pass
  tenant context; no logic change
- `api/pos-credit.mjs` (+ mirror) — tenant from path, per-tenant secret
- new: `api/ops-tenants.mjs`, `api/ops-assets.mjs` (signed upload URLs),
  `api/tenant-config.mjs` (public published manifest by slug) + mirrors
- `src/campaign/schema.js` — add `gameFormat`; stays the one validator used by
  both the API and the game

**Phase 3 — ops dashboard** (`claimlabs-dashboard`, pending D2)
- `src/app/(ops)/tenants/page.tsx`, `tenants/new/*` (wizard: create → assets →
  format + rewards → preview → publish), `tenants/[slug]/page.tsx`,
  `(ops)/overview/page.tsx` (cross-tenant)
- `src/lib/game-api.ts`, `src/lib/data.ts`, `src/lib/types.ts` — tenant-scoped
- staff authentication — **does not exist today** and is required before a tool
  that can create tenants and set prize odds goes anywhere near a URL
- Server Components + Server Actions rather than adding SWR/React Query

**Phase 4 — per-tenant boot** (this repo)
- `src/main.js`, `src/campaign/loader.js` — resolve `/play/<slug>` → fetch
  published config → existing `applyCampaign()`
- `src/services/api.js` — attach tenant slug to every call (still the only
  transport; `loyalty.js` stays the only reward caller)
- `vercel.json`, `netlify.toml` — `/play/:slug` rewrite
- No slug = today's McDonald's build, byte-for-byte. That is the parity path.

**Phase 5 — verification**
- Playwright project running two tenants in parallel contexts; existing 732
  e2e tests run unmodified against no-slug and `/play/mcdonalds`, screenshots
  diffed; `git diff --stat` per phase checked against the path locks above.

## 5. Decisions needed before Phase 1

- **D1 — OTP.** Keep unverified phone identity (July 2026 decision), or add OTP
  before reward issuance? OTP needs an SMS provider and per-message cost, and
  it changes the player journey.
- **D2 — Which dashboard.** Recommended: extend `claimlabs-dashboard` (the only
  Next.js app), add an `(ops)` area plus staff auth, and give it a git remote.
  The alternative is the React dashboard on `claude/mcdonalds-dashboard-backend-afnn7g`.
- **D3 — Branching.** Merge `fix/viewport-leaderboard-ui` into `main` first,
  then create `dev` off `main`, then `feature/multi-tenant` off `dev`?
- **D4 — Catch the Fries.** Enum value only (wizard option disabled), or omit it
  until the engine exists?
- **D5 — Database.** Which Supabase project is live for McDonald's, does it hold
  real player data, and who runs the migration against it? A local Supabase
  (Docker) is needed for the integration tests regardless.
- **D6 — Prize odds in the wizard.** The compliance flag is still open. Should
  the wizard let staff set prize weights, or only pick from a reviewed preset
  until legal sign-off exists?
- **D7 — URL shape.** Recommended: `claimlabs.com/play/<slug>` (no wildcard DNS or
  per-tenant certificates) over `<slug>.claimlabs.com`.
