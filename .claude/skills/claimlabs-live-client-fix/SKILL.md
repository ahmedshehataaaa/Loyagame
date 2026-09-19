---
name: claimlabs-live-client-fix
description: End-to-end workflow for fixing or changing a LIVE restaurant client on the multi-tenant Slice Rush platform (loyagame.vercel.app/play/<slug>/) — from a player's complaint ("it says no prize has been issued", "my points don't save", "tailor the wheel") to a verified production fix. Covers reading production logs first, reproducing against a Supabase-shaped local database, per-tenant settings instead of forks, safe deploy ordering, applying a production migration, and proving the result. Use whenever a report comes from a real player or the owner about a deployed client, or a brief asks to change prizes, win rules or the wheel for one restaurant.
---

# Fixing a live client, start to finish

This is how the Jimmy's Pizzeria issues were fixed on 2026-09-19: the win
rule, the wheel's branding, coupon minting, My Rewards and sign-in. Each step
below prevented a real mistake that day. Follow them in order.

Live pieces: game `loyagame.vercel.app` (root = McDonald's,
`/play/<slug>/` = a client), staff tool `claimlabs-ops.vercel.app`, Supabase
project `claimlabs-db`. Pushing `main` auto-deploys the game in about 30 seconds.

## 1. Read production before reading code

A player's message says what they saw, not why. Get the server's version first:

```bash
vercel logs --no-branch --environment production --since 2h -n 100 -j \
  | grep '"/api/\(start\|submit\)-run\|session-status'
```

Pull `requestPath`, `statusCode` and `message` from each JSON line. Ignore the
"default export returned a Response" warning. It is expected noise from the
handler wrapper (`lib/http.mjs`).

Map the screen to the request:

| Player sees | Look at |
|---|---|
| "We couldn't confirm a prize… No prize has been issued" | `submit-run` 500 (a server fault) **or** `start-run` 4xx (no round token, so nothing to confirm) |
| "Sign in to win" | no identity stored for this tenant |
| a score that "doesn't save" | whether that tenant gates on order points (`settings.wheel_gate`) |

The same symptom had two different causes on the same day: first a 500 from
`gen_random_bytes`, then a 400 from `start-run`. Check again every time.

Read the client's live config without guessing:
`curl "https://loyagame.vercel.app/api/tenant-config?slug=<slug>"`. Note that
the parameter is `slug`, not `tenant`.

## 2. Treat briefs as intent, not code

Briefs arrive written for a different stack (Phaser, Express, SQLite, React).
None of that exists here. Take the goal and implement it in this repo's shape.

**Never adopt a "fallback" that issues a code when the server fails.** One
brief asked for codes on any error and a code minted in the browser. That
hands out real food to anyone, and the cashier can't tell real codes from
fake ones. Codes come only from `resolve_run`. Fix the fault instead
(CLAUDE.md, Security non-negotiables).

Check prize ideas against the client's real menu
(`Desktop\claimlabs-<client>\research\`) before adding them. Staff can't hand
over an item the restaurant doesn't sell.

## 3. Change a client through settings, never a fork

Per-client behaviour is a `settings` row or the published manifest, never a
copied engine (`claimlabs-configurable-reskins`).

- **The manifest's `rewards` block is rewritten on every publish** from a
  reviewed preset (`ops_publish_version`). Anything stored there reverts.
  Durable per-tenant switches go in `settings` (e.g. `wheel_gate`,
  `win_lockout_hrs`), which publish never touches. If the game's copy needs the
  value, `tenant_published_config` merges it into the public manifest
  (migration 0007).
- **An unknown setting value must fall back to the stricter rule.** For
  example, anything other than an exact `'score'` means order points, so a typo
  can never open a wheel.
- **Word the copy for the rule actually in force**, in both EN and AR
  (`src/core/i18n.js`, where a parity test enforces it). A score-gated client
  whose screens still said "order points" looked like a broken backend.

## 4. Reproduce on a database shaped like Supabase

`npm run test:integration` boots real Postgres and PostgREST
(`tests/integration/support/stack.js`). It only catches production bugs where
it matches Supabase:

- **pgcrypto lives in the `extensions` schema**, which `app_tenant` can't see.
  The shim now installs it there. Never call pgcrypto (`gen_random_bytes`,
  `digest`…) from a function the tenant role runs. Use `gen_random_uuid()`
  (core Postgres) instead (migration 0008). While pgcrypto sat in `public`, a
  bug that broke every production win passed all tests.
- **First write the test, watch it fail with the production error text, then
  fix.** Fix the environment before the code if it is the environment that
  differs.

## 5. Windows line endings break two things

`core.autocrlf=true` checks out files with CRLF endings:

- Vitest can't load `#!` scripts with CRLF, so every integration test dies
  with "Invalid or unexpected token" at `stack.js:8`.
- `scripts/db-migrate.mjs` refuses production: "0001 … applied with a
  different checksum".

The fix is to convert to LF: `sed -i 's/\r$//' scripts/*.mjs database/migrations/*.sql`.
Git shows no diff, because it stores LF. Don't weaken the checksum check.
The real `npm run verify` also fails `format:check` on CRLF alone. Use
`npx prettier --check --end-of-line auto` to see real formatting drift.

## 6. Verify, and blame only what you caused

1. `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`.
2. Browser suite on one viewport, **compared against unchanged `HEAD`**.
   Around 30 tests per viewport already fail on `main`. Run the same project
   in a `git worktree` of `HEAD` (junction `node_modules` in, create
   `dist/index.html`), diff the failing titles, and report only new ones.
3. **Drive the real screen.** Serve with `PORT=8796 python server.py`, open
   `/play/<slug>/#/…` in Playwright at 390×844, and stub `/api/*` with the
   live manifest (from step 1). Open the wheel with
   `window.LoyaltyData.submitRun(...)` then `window.UI.showChooser(...)`, as
   `tests/e2e/spin-wheel.spec.js` does. Screenshot it and look at it.
   Headless rAF runs at about 1.3 fps, so never wait out a real round.

## 7. Deploy in an order that can't break other tenants

- Keep the **12-function Hobby cap**. `api/` has 11 files. Extend an existing
  endpoint (e.g. `session-status` now also returns wins) instead of adding one.
- Edit `api/*.mjs` and its `netlify/functions/*.mjs` mirror together.
- **Code must run against the old AND new database.** Only pass a new RPC
  parameter when it is actually needed
  (`...(gate === 'score' ? { p_gate: gate } : {})`). Naming a parameter the
  live function lacks makes PostgREST 404 every round for every tenant.
- Push `main`, then poll the live bundle for a string only the new build has,
  instead of sleeping.

## 8. Production database changes

Production migrations and settings writes need the owner's explicit OK
(CLAUDE.md). Get it in plain words: say what changes and who is affected.

Apply them with a throwaway script that never prints secrets. It pulls
`POSTGRES_URL_NON_POOLING` with `vercel env pull` into a temp file, deletes the
file, appends `uselibpqcompat=true`, and runs `applyMigrations` from
`scripts/db-migrate.mjs`. The script must:

- dry-run first and **abort unless exactly the expected migration is pending**
- print settings before and after any `settings` upsert
- prove the result under the real role inside a rolled-back transaction
  (`begin; set local role app_tenant; select …; rollback;`), which creates no
  real coupon
- be deleted afterwards (don't commit it)

Then re-read the public endpoint (`tenant-config`, `session-status`) to confirm
production says what you intended.

## 9. Security rules that held all day

- A coupon code is a bearer token and phone identity is unverified. Return
  codes only for wins on the **same device id** (`session-status`).
- Anything that makes the client-reported score pay out is new real-money
  exposure. Write it in an ADR (`docs/decisions/0019-score-gated-wheel.md`)
  and tell the owner. Don't bury it.
- When the server rejects a stored identity, **let the player recover**
  (clear it and show sign-in). A permanent generic error looks like a broken
  game.

## 10. Report like the owner will read it

The owner is not a developer. Lead with what the player will now see, then
what to tap to check it. Say exactly what was and wasn't verified live.
For example, "I couldn't create a real coupon from here, so please play one
round".
