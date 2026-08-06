---
description: Rules for external integrations — Vercel, Netlify, Foodics POS, Supabase
globs: ["vercel.json", "netlify.toml", ".vercel/**", "api/pos-credit.mjs", "netlify/functions/pos-credit.mjs", "supabase/**"]
---

# Integrations

- **Vercel**: this is the primary deploy target. `mcdonalds/.vercel` was
  detached from Krispy Kreme's live project on 2026-08-06 (ADR 0002) and
  has not been relinked — do not assume any `.vercel/project.json` present
  is correct without verifying the project name via the Vercel MCP tools
  first. Production promotion always requires explicit human approval.
- **Netlify**: secondary/mirror deploy target — `netlify.toml` redirects
  `/api/*` to `/.netlify/functions/*` so the same client code works on
  either host. `netlify/functions/*.mjs` must stay behaviorally identical
  to `api/*.mjs` — check both on any backend change.
- **Foodics (POS webhook)**: `api/pos-credit.mjs` /
  `netlify/functions/pos-credit.mjs`, secret-verified via
  `isPosCaller()`/`secretEquals()`. This is the only path that credits
  real order-points — idempotency on the transaction/order ID is load-
  bearing, not optional. Any change here needs a `security-adversary` pass.
- **Supabase**: accessed via raw PostgREST `fetch` (`lib/db.mjs`), service-
  role key server-side only, RLS assumed to block all other access (not
  independently re-verified this session — confirm RLS policies actually
  exist and are correct before treating that assumption as fact).
- **Stitch**: connector has had tool-fetch failures — check connection
  status before relying on live access; fall back to the already-extracted
  `mcdonalds/stitch-export/` snapshot. See `claimlabs-stitch-to-code`.
- **GitHub**: no repository exists yet in this project (see
  `docs/project-inventory.md` "blockers") — nothing to connect to until
  one is created, which itself requires human approval (`git init` +
  choosing a remote).
- **Sentry**: not yet configured; planned for pre-commercial-launch per
  the ClaimLabs connector plan. Don't assume error tracking exists until
  it's actually wired up.
- **Never configure unrestricted production database write access** for
  direct agent use — local/dev or a read-only production connection only.
