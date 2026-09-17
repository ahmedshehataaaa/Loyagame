# 0018 — One build, many restaurants: tenancy in Postgres, not in forks

Date: 2026-09-16
Status: Accepted
Plan: `docs/plans/2026-09-15-multi-tenant-phase-0.md`

## Context

ClaimLabs has to onboard a second restaurant without a code fork and without
staff touching the database, while every client's players, coupons and prize
odds stay walled off from every other client's.

The Phase 0 plan found that the brief behind this work described an older stack
(Phaser, Express, SQLite, OTP). The real one is a canvas engine, Vercel
functions and Supabase Postgres, with deliberately unverified phone identity.
The owner's decisions on the plan (2026-09-15):

- **No OTP.** Identity stays unverified, as decided in July 2026.
- **A new ops dashboard**, separate from the brand-facing one.
- **Prize odds come only from reviewed presets.** Staff never type weights.
- **`/play/<slug>/` URLs**, not subdomains.
- The remaining calls (branching, Catch the Fries, database rollout) were left
  to the implementer. They are recorded below.

## Decision

**Isolation lives in the database.** Every tenant-scoped table (`players`,
`points_ledger`, `runs`, `wheel_wins`, `settings`) carries `tenant_id` with
composite foreign keys, so a row can't point at another tenant's player even
from buggy code. Request traffic no longer uses the service key, which bypasses
RLS. Each request mints a 60-second JWT for the `app_tenant` role with a
`tenant_id` claim, and RLS policies key on that claim
(`database/migrations/0004`). The reward RPCs are unchanged apart from the
tenant predicate. Coupon codes stay globally unique bearer tokens with a
per-tenant prefix, and redemption is tenant-scoped.

**The existing McDonald's build is the legacy tenant.** Migration 0002
backfills every existing row to tenant `00000000-…-0001` inside one
transaction, and verifies row counts and checksums before it commits. The site
root with no slug, and API calls with no `X-Tenant` header, behave exactly as
before.

**One static build serves every tenant.** `/play/<slug>/` is rewritten to the
same files (`vercel.json`, `netlify.toml`, `server.py`, `scripts/dev-stack.mjs`).
`src/core/tenant.js` reads the slug from the path. On a tenant page:

- nothing paints until `/api/tenant-config` returns that tenant's published
  manifest, and a manifest for any other `brand.id` is refused;
- a failure shows a brand-neutral "unavailable" screen, never a fallback to
  another restaurant;
- localStorage keys are suffixed `@<slug>`, so one restaurant's page never reads
  another's player;
- every API call sends `X-Tenant`;
- `?campaign=` is ignored;
- the welcome and sign-in copy, logo and hero sprites come from the manifest
  (`src/campaign/brand-copy.js`).

`engine/**` and `src/game/**` are untouched.

**Onboarding is data, versioned and audited.** `tenant_config_versions` holds
drafts. A draft's `rewards` block is always discarded: rewards are composed at
preview and publish time from a reward preset plus the client's prize names,
and publishing needs a preset a named person has reviewed. Reviewed presets
can't be edited (`reward_presets_lock`). Every change goes through an `ops_*`
function that records a named actor in `tenant_events`.

**Draft previews are signed.** `signPreviewToken` issues a 30-minute token
bound to the slug and version. The game plays a preview with
`CONFIG.API.enabled = false`, so a preview can't mint a coupon.

**Brand assets go straight to Storage.** `api/ops-assets.mjs` signs an upload
URL for `tenant-assets/<tenant id>/<kind>/<uuid>.<ext>`. The path is built on
the server, and bucket policies (0006) enforce the same folder rule. Reads are
public because players' browsers load the sprites.

**The ops dashboard is a separate Next.js app** (`Desktop/claimlabs-ops`), on
the brand dashboard's design system (shadcn base-nova, Recharts). It holds
`OPS_ADMIN_KEY` server-side only and requires a signed staff session. v1 uses
one shared password plus the person's name, which becomes the audit actor.

**Implementer's calls:**

- Git: `dev` branched from `main`, work on `feature/multi-tenant`.
- Catch the Fries: declared in the `game_format` enum, but `ops_create_tenant`
  refuses it and the wizard option is disabled until the engine exists.
- Production migration: a human runs `node scripts/db-migrate.mjs
  --confirm-remote` against the live project after a backup. The agent never
  does.

## Consequences

- Isolation is proved against a real Postgres and the real PostgREST binary
  (`npm run test:integration`, 81 tests), not a mock. That covers cross-tenant
  reads per table and per RPC, coupon redemption across tenants, lockouts that
  don't leak between brands, and the migration's zero-loss proof.
- The client half is proved by `tests/e2e/tenants.spec.js`: two tenants at once
  on all six viewports. The full onboarding path through the ops UI, against
  the real stack, is proved by `claimlabs-ops/e2e/onboarding.spec.ts`.
- New devDependencies, test and tooling only, never shipped: `pg` and
  `embedded-postgres` (a real Postgres for the integration tests and
  `dev:stack`). PostgREST is a pinned binary fetched on demand into `.cache/`
  (`scripts/fetch-postgrest.mjs`). The functions still ship with zero npm
  dependencies.
- `npm run dev:stack` is now the way to run the real backend locally. `npm run
  dev` (Python) stays the fast path for game work.
- Tenant-config responses are cached for 30 seconds, so a pause or a new
  publish reaches players within about a minute, not instantly.
- The shared staff password is a stopgap. Replace it with SSO before more than
  a handful of people use the ops tool.
- Before the migration runs in production, check the live `settings.wheel_prizes`
  row. `schema.sql` seeded Krispy Kreme prize labels, and `submit-run` draws
  from `settings`, not from the McDonald's manifest.
