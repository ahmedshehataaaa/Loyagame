---
name: claimlabs-release
description: Release workflow for Slice Rush — preview deployment, smoke tests, migration review, release notes, rollback. Use alongside the release-manager agent for anything heading toward a deploy. Production promotion always requires explicit human approval.
---

# ClaimLabs release workflow

## Preconditions specific to this project (check every time, not just once)

1. **Vercel project identity.** `mcdonalds/.vercel` was detached from a
   shared/wrong project on 2026-08-06 (ADR 0002) and has not been
   relinked as of this writing. Before any deploy: confirm (via `vercel
   link` interactively, or the Vercel MCP `get_project` tool) exactly
   which project is the target, and get explicit human confirmation. Never
   assume a `.vercel/project.json` that exists is correct without
   checking its `projectName` against what's intended.
2. **Environment variables set on the target deployment**: `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, `ADMIN_KEY`, `FOODICS_WEBHOOK_SECRET`. Cannot be
   verified from this repo alone — ask the human to confirm via the
   Vercel dashboard, don't assume.
3. **Open compliance flag.** If the release touches `WHEEL` or
   `resolve_run`, `docs/security/reward-wheel-compliance.md` must be
   explicitly addressed in the release notes — resolved, or knowingly
   deferred with sign-off recorded.

## Steps

1. **Build verification** — no bundler/test suite exists yet, so this
   means: every changed `.js`/`.mjs` parses (`node --check`), every
   changed `.json` parses, and the app actually boots in a real browser
   with no console errors (rule out the dev-server threading issue from
   ADR 0003 first if testing locally — it can masquerade as a real app
   break).
2. **Migration review** — any `supabase/schema.sql` change: additive and
   backward-compatible, or does it need careful ordering relative to the
   code deploy? No migration framework exists yet (`claimlabs-database`);
   until one does, review manually and document the exact SQL that will be
   run and when.
3. **Release notes** — reconstruct from `docs/decisions/` (ADRs) and the
   actual diff since the last release; no Git log exists yet to summarize
   from automatically.
4. **Preview deployment** — deploy to preview, not production.
5. **Smoke test** — `qa-browser-engineer` drives the preview URL: app
   boots, a round can be started and played, a `submit-run` round-trips
   successfully. Attach real evidence (screenshot, network response), not
   a description.
6. **Rollback plan** — identify the previous Vercel deployment ID/URL
   before promoting, so "redeploy the previous one" is a known, tested
   action if something breaks, not something worked out under pressure.
7. **Human approval gate** — production promotion is proposed with the
   above evidence attached; a human explicitly approves before it happens.
   This is non-negotiable per CLAUDE.md, regardless of how clean the
   checks look.

## After release

Update `docs/decisions/` with an ADR if the release included an
architecture-relevant change; update `docs/project-inventory.md` if it
changes what's true about the current build's stack or state.
