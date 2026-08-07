---
name: claimlabs-testing
description: Testing requirements for Slice Rush — unit, integration, database, browser, gameplay, reward-abuse, regression tests, and production build verification. Use whenever proposing what "tested" means for a change, and especially when standing up the first real test suite.
---

# ClaimLabs testing

## Starting point: there is nothing yet

No `package.json`, no test runner, no CI config exist anywhere in
`mcdonalds/`. Every verification claim in this project's history prior to
2026-08-06 was ad hoc (a throwaway, uncommitted diagnostic HTML harness,
per the inherited `PROGRESS.md`). Don't describe existing coverage that
isn't there.

## What "tested" means today, per layer, until a real suite exists

- **Gameplay/canvas** (`engine/`): drive it in a real browser
  (`qa-browser-engineer`), confirm the specific HUD/behavior change with a
  screenshot or read DOM/canvas state directly. A code read is not a test.
- **Backend/RPCs** (`api/`, `supabase/schema.sql`): `curl` the actual
  endpoint or call the RPC directly and show the response. For anything
  security-relevant, `security-adversary`'s exploit-attempt checklist _is_
  the test.
- **UI** (`src/`): screenshot at a real mobile viewport, compare against
  the Stitch reference if one exists (`claimlabs-stitch-to-code`).
- **Config validity**: `node --check` on any `.js`/`.mjs`, `JSON.parse` on
  any `.json` — already automated via `.claude/hooks/post-edit-check.js`.

## Recommended first real test suite (when this becomes the task)

Given the actual stack (vanilla JS, no bundler, Vercel Functions,
Supabase): **Playwright** for browser/gameplay tests (already the
project's stated preference for browser automation per the connectors
list) + a lightweight Node test runner (`node --test`, built into Node 24 —
already installed in this environment, no new dependency needed) for
backend/RPC tests hitting a local or staging Supabase instance. This
avoids introducing Jest/Vitest as a second toolchain when Node's built-in
runner covers the need without adding a `package.json` dependency burden
beyond Playwright itself.

Required categories once a suite exists (don't skip any when adding
coverage for a new feature):

- **Unit**: pure logic — scoring math, combo windows, discount-tier
  resolution.
- **Integration**: `api/*.mjs` handlers against a real (local/staging)
  Supabase instance, not mocks — see `claimlabs-database`'s locking
  guarantees; a mocked DB would hide exactly the race-condition class of
  bug this project cares most about.
- **Database**: RPC-level tests for `resolve_run`/`start_play`/
  `credit_order_points` directly, including the concurrent-call race case.
- **Browser/gameplay**: full round playthroughs, both win and loss paths,
  at real mobile viewport sizes.
- **Reward-abuse**: the `claimlabs-anti-cheat` threat table, each row as an
  actual test case (replay a token, submit implausible score, etc.), not
  just documented as a risk.
- **Regression**: once a bug is fixed, its reproduction becomes a test —
  don't fix and move on without one (see `claimlabs-debugging`).
- **Production build verification**: since there's no bundler, this means
  "does every file actually load with no console errors when served the
  way production will serve it" — the ADR 0003 dev-server bug is exactly
  the kind of thing this category should have caught automatically.

## Test fixtures

`database/fixtures/`/`database/seeds/` don't exist yet (see
`claimlabs-database`). Any integration test suite needs deterministic seed
data — build this alongside the first integration tests, not as an
afterthought.
