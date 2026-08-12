# 0017 — The admin dashboard is React + shadcn/ui, isolated from the game

Date: 2026-08-12
Status: Accepted

## Context

The admin API had been complete for some time: `admin-stats`, `admin-players`,
`admin-redemptions` and `admin-engagement` all shipped, each gated by
`isAdmin()` and each aggregating inside a Postgres RPC. What did not exist was
anything that read them.

`admin.html` was the dashboard, and it was **broken**. It loaded
`js/config.js` and `js/admin.js`; there is no `js/` directory in this
repository. The only `admin.js` is in `_legacy-ui-backup/`, which is explicitly
not shipped. The page therefore rendered its static shell and nothing else —
and `scripts/build.mjs` copied it into `dist/` on every build, so a blank page
was being deployed. Its wordmark also still read **Krispy Kreme**, the same
category of fork leftover that `DESIGN.md` and `README.md` carried until
2026-08-06.

So the work was not "wire up the existing dashboard". The dashboard had to be
built.

## Decision

**The admin dashboard is a React application using shadcn/ui and TanStack
Query, and it lives in `dashboard/`, entirely outside `src/`.**

This is a deliberate exception to CLAUDE.md's "no framework, no bundler" rule,
requested explicitly and recorded here because that rule is otherwise still in
force. The exception is scoped as narrowly as it can be:

- **The game does not change.** `engine/` stays classic scripts, `src/` stays
  bundler-free ES modules, `npm run dev` still serves the source with no
  compile step. Nothing React touches the player-facing build.
- **Separate build.** `scripts/build-dashboard.mjs` is its own esbuild + Tailwind
  invocation with its own size budget. Folding it into `scripts/build.mjs` would
  have put the game's bundle-size guard on the wrong side of a 200KB UI library.
  `npm run build` runs both, so a deploy is still one command.
- **Separate lint dialect.** `eslint.config.js` gains a fourth block for
  `dashboard/`, with JSX parsing and `react/jsx-uses-vars` so `no-unused-vars`
  stays on and correct rather than being switched off for the directory.
- **No TypeScript.** shadcn/ui is normally TSX; these are `.jsx`. Introducing TS
  is its own architecture decision (`.claude/rules/typescript.md`) and bundling
  it into this change would have made the blast radius much larger.

### Auth: the key is typed in, never bundled

The endpoints authenticate with an `x-admin-key` header compared against
`process.env.ADMIN_KEY`. A static page cannot hold that secret — a build-time
constant would ship the admin key to anyone who fetches the JS. So the operator
types it into a gate, it is verified against a live endpoint before being
stored, and it is kept in `sessionStorage` (dies with the tab) and sent only as
a header, never a query string where it would land in logs and `Referer`.

A 401 from any panel clears the key and returns to the gate, handled once in
the query cache rather than five times in five components.

### Freshness: polling, not sockets

TanStack Query refetches every 10 seconds. A round finishing on the shop floor
appears in the KPI tiles, the players table and the redemption feed without a
manual refresh — verified by finishing a round from outside the browser and
watching the tiles change with the navigation count unmoved. No websocket or
SSE, which would mean a stateful connection this serverless backend has nowhere
to terminate.

### Single-tenant, on purpose

The header reads "ClaimLabs Dashboard — McDonald's" and the client name is a
constant. There is **no client switcher**, because there is nothing behind it:
`players`, `runs` and `wheel_wins` carry no tenant or campaign column.
Multi-tenancy is a schema change first and a UI change second.

### One new endpoint, one additive RPC change

- `api/admin-fraud.mjs` (+ Netlify mirror) is new. It is shaped over PostgREST
  rather than a new RPC specifically so it needs **no migration** — it works
  against an already-deployed database.
- `admin_redemptions` is re-declared at the end of `supabase/schema.sql` to
  include the **last four characters** of `wheel_wins.code`. It is re-declared
  rather than edited in place because the file is applied top-to-bottom by hand
  and the original declaration sits above the `alter table … add column code`
  it now depends on. **This section must be applied manually** before coupon
  tails appear; the UI renders a missing tail as an em dash, so it degrades
  cleanly until then.

  The truncation is server-side on purpose. A coupon code is a bearer token —
  whoever holds the string can claim the prize — and the dashboard only ever
  displays it masked, so sending the full value to a browser would be exposure
  that buys nothing. Dashboard redemption goes through `redeem_wheel_win(win_id)`
  and never needs the code.

## Consequences

- The repository now has runtime npm dependencies for the first time. They are
  confined to `dashboard/`; `api/`, `lib/` and `engine/` still import nothing.
  All 5 `npm audit` findings pre-date this change (vitest/vite dev toolchain).
- The dashboard bundle is ~682 KB (React + Recharts). That is heavy for this
  repository's standards and acceptable for an internal tool behind an admin
  key; the build fails above 900 KB so a runaway import is caught.
- `admin.html` is no longer a source file. It is generated into `dist/`, so the
  deployed URL is unchanged. In development it is served from
  `/dist/admin.html` after `npm run build:dashboard`.
- `dev_api.py` and `server.py` now answer the admin endpoints over GET, so the
  dashboard can be developed and tested on a laptop. Same rationale the dev
  backend was created under: an admin UI that can only run against a deployed
  Supabase project is one nobody will maintain.

## Verification

- `npm run verify` green: format, lint, typecheck, campaign manifests, 204 unit
  tests (15 new, covering series gap-filling and masking).
- `npm run build` green, both builds, dashboard within budget.
- Driven in headless Chromium against the dev backend seeded by playing real
  rounds through `start-run`/`submit-run`: gate rejects a wrong key and accepts
  the right one, all five tabs render real data, dark mode and a 390px viewport
  both hold up, and the only console error is the deliberate 401 probe.
- Live polling proven: a round submitted from outside the browser moved Total
  plays 28 → 29 and put the new coupon in the feed, with the navigation count
  unchanged.

## What this does not resolve

`settings.wheel_prizes` in `supabase/schema.sql` still seeds **Krispy Kreme**
prizes ("Free Original Glazed", "5% off a dozen"), and `api/submit-run.mjs`
reads prize content from that row. `engine/config.js` is correctly McDonald's.
On a database seeded from this file, the dashboard will faithfully display
donut prizes because that is what the server actually awarded. This was left
untouched deliberately: `WHEEL` and prize content are security-sensitive with
real money exposure, and `docs/security/reward-wheel-compliance.md` is still
open. It needs a decision, not a drive-by edit.
