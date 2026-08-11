# Release runbook

## Before you start

Two things must be done **by a human**, and neither is automatable from here:

### 1. Apply the database schema

`supabase/schema.sql` is applied by hand (no migration framework — see
`.claude/rules/database-migrations.md`). The 2026-08-07 change added a survival
gate to `resolve_run` and **drops the old 8-argument overload**, deliberately:
a stale deployment then fails loudly instead of silently resolving runs without
the gate.

Also inserts two `settings` rows the API reads: `round_time_sec`,
`survival_tolerance`.

### 2. Link a Vercel project this build owns

`.vercel/` was detached from Krispy Kreme's live project (ADR 0002) and never
relinked. **Verify the project name before deploying** — a deploy from here
previously would have overwritten a different client's production site.

## Environment variables

Server-side only. None of these may appear in client code; a hook scans for
hardcoded instances on every edit.

| Variable                 | Used by                       |
| ------------------------ | ----------------------------- |
| `SUPABASE_URL`           | `lib/db.mjs`                  |
| `SUPABASE_SERVICE_KEY`   | `lib/db.mjs`                  |
| `ADMIN_KEY`              | admin endpoints, `isAdmin()`  |
| `FOODICS_WEBHOOK_SECRET` | `pos-credit`, `isPosCaller()` |

## Release steps

```bash
npm ci
npm run verify        # format, lint, types, manifests, unit
npm run build         # -> dist/
npm run test:e2e      # 654 tests inc. production-build.spec.js against dist/
npm run perf          # optional: record the baseline for this release
```

Then publish `dist/`. Do **not** publish the source tree: it has no content
hashing, which is the whole reason the build exists.

## Post-deploy checks

1. **Load the campaign URL on a real phone.** Portrait, one HUD, `SURVIVE 30s`.
2. **Slice something.** This is not a formality — the game shipped for a while
   in a state where nothing could be sliced because an overlay ate every
   pointer event (ADR 0015). Swipe across an item and watch the score move.
3. **Sign in with a real number**, confirm the stake label flips from "Practice
   round" to "Prize round".
4. **Survive a round** and confirm the result screen shows either a
   server-issued prize or an honest reason there is none. If a prize appears,
   confirm it also exists in `wheel_wins`.
5. **Switch to Arabic**, confirm RTL and that nothing overflows.
6. **Check the service worker registered** (DevTools → Application). It never
   did before 2026-08-07.

## Rolling back

`dist/` is content-hashed, so redeploying the previous build is sufficient — no
cache purge needed. The database change is additive apart from the dropped
`resolve_run` overload; if you must roll back the API, restore that overload
from tag `baseline-2026-08-07` **before** reverting the deployment, or
`submit-run` will fail closed for every player.

Failing closed is the intended behaviour: no prizes issued is recoverable, wrong
prizes issued is not.
