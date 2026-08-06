---
description: Highest-scrutiny paths — reward issuance, session tokens, admin/POS auth, campaign budgets
globs: ["supabase/**", "lib/db.mjs", "api/submit-run.mjs", "api/start-run.mjs", "api/pos-credit.mjs", "api/admin-*.mjs", "netlify/functions/submit-run.mjs", "netlify/functions/start-run.mjs", "netlify/functions/pos-credit.mjs", "netlify/functions/admin-*.mjs", "engine/config.js"]
---

# Security-sensitive code

Any change matching these paths requires a `security-adversary` pass
(actual exploit attempts against running code — see that agent's
checklist) before it's reported done. This is not optional for this
category, per CLAUDE.md's Definition of Done.

- **Row-locking discipline**: any new read-then-write on `players.
  order_points`, `runs`, or `wheel_wins` must take a `FOR UPDATE` lock in
  the same transaction, matching `resolve_run`'s pattern
  (`supabase/schema.sql` ~lines 385, 401). A race condition here is a
  financial-liability bug, not a style issue.
- **`engine/config.js` is included in this rule** specifically because
  `WHEEL`, `DISCOUNT_TIERS`, and `LIMITS` are content that directly
  controls real money exposure — treat changes to these constants with the
  same scrutiny as changes to `resolve_run` itself, not as a cosmetic
  config edit.
- **Open compliance flag**: `docs/security/reward-wheel-compliance.md` —
  read it before touching `WHEEL` or `resolve_run`'s prize-selection logic.
  Surface it in every review that touches this area; do not resolve it
  unilaterally.
- **Secrets**: `SUPABASE_SERVICE_KEY`, `ADMIN_KEY`,
  `FOODICS_WEBHOOK_SECRET` — `process.env` only, compared via
  `timingSafeEqual` (`secretEquals` in `lib/db.mjs`), never logged, never
  returned in a response body. `.claude/hooks/post-edit-check.js` scans
  for hardcoded instances automatically on every edit to these paths — if
  it blocks a save claiming a hardcoded secret, that's very likely correct;
  double-check before assuming it's a false positive.
- **No debug/cheat bypasses for gating, points, or session checks** — even
  temporarily, even behind a query param. A prior lineage
  (`fastfood-ninja`) shipped an `O`-key demo point-cheat; don't reintroduce
  that pattern here.
- **Idempotency**: any new one-time resource (token, code, redemption)
  must be marked consumed inside the same transaction that uses it.
