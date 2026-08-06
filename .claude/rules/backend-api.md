---
description: Rules for backend API code (Vercel Functions + Netlify mirror)
globs: ["api/**", "netlify/functions/**", "lib/**"]
---

# Backend / API code

- **Keep `api/*.mjs` and `netlify/functions/*.mjs` in sync.** They are
  hand-maintained parallel copies (no generator) — a change to one without
  the other is drift, not a completed change. Check both before reporting
  done.
- **Use the existing helpers, don't reinvent them**: `ok()`/`bad()` for
  responses, `readBody()` for parsing, `isAdmin()`/`isPosCaller()` for
  auth, `secretEquals()` for any new secret comparison, `rpc()`/`sb()` for
  all database access (raw PostgREST `fetch`, no ORM). See
  `claimlabs-backend-api`.
- **No business logic here beyond validation and shaping the response.**
  Decisions that touch shared state (points, budgets, one-time resources)
  belong in a Postgres RPC (`supabase/schema.sql`), inside a row-locked
  transaction — not in the JS handler, where the locking guarantee is
  lost.
- **Every external-trigger endpoint (webhooks) must be idempotent** on its
  natural key (order ID, transaction ID) — match `points_ledger_order_uniq`.
- **No new dependency without a `package.json` decision first** — this
  layer currently ships with zero npm packages by design (plain `fetch`,
  no framework). Adding one is a real, documented decision, not an
  incidental `import`.
- Secrets (`SUPABASE_SERVICE_KEY`, `ADMIN_KEY`, `FOODICS_WEBHOOK_SECRET`)
  come from `process.env` only — see `.claude/rules/security-sensitive.md`
  for the full list of what's checked automatically.
