---
description: Rules for database schema and (future) migrations
globs: ['supabase/**', 'database/**']
---

# Database & migrations

- **No migration framework exists yet.** `supabase/schema.sql` is applied
  by hand, `create table if not exists`/`create or replace function`
  throughout — idempotent-by-convention, not versioned. Don't assume a
  change here is automatically deployed anywhere; it must be manually
  applied against the target Supabase project, by a human, for anything
  beyond local dev.
- **`database/migrations/`, `database/seeds/`, `database/fixtures/` don't
  exist yet** despite being part of the target architecture — standing
  this up is a legitimate first-implementation-task candidate, not
  something to skip indefinitely.
- **Every RPC that mutates a shared balance or one-time resource must lock
  first** (`FOR UPDATE`) — see `.claude/rules/security-sensitive.md`.
- **Prefer additive schema changes.** No rollback tooling exists for
  destructive changes (dropped columns/tables) — if a change isn't
  additive, the rollback plan needs to be written out explicitly before
  applying it, not improvised afterward.
- **Production database writes/migrations require explicit human
  approval** and should be run by a human, not autonomously — per
  CLAUDE.md. Only local/dev or a read-only production connection should
  ever be wired up for direct agent use.
- **Config that should be tunable without a redeploy belongs in the
  `settings` table**, not hardcoded in a migration or in `engine/
config.js` alone — check `settings` for the live value of anything like
  `min_run_ms`, `max_plausible_score`, `wheel_points_threshold` before
  assuming the `engine/config.js` value is authoritative (it's the client
  mirror/offline fallback).
