# REVIEW.md — Slice Rush code review checklist

Used by the `lead-architect` (final review), `security-adversary`
(adversarial pass on rewards/sessions/campaigns), and anyone reviewing a
diff by hand. See `claimlabs-code-review` skill for the full workflow this
checklist belongs to.

## Correctness

- [ ] Does the diff match the requested scope? (`git diff` should not touch
      unrelated files — flag any surprise changes.)
- [ ] If it touches `engine/config.js`, is the change reflected everywhere
      the value is read? (`grep` for the constant name across `engine/` and
      `src/` — e.g. `ROUND_TIME`/`START_LIVES` are each read from exactly
      one place today; don't assume that stays true.)
- [ ] If it touches `engine/` **or** `src/`, does it account for the two
      layers not being reconciled? (See CLAUDE.md's architecture-boundaries
      section.) A fix in one layer that doesn't also fix the other is
      usually incomplete, not wrong.
- [ ] Was the change actually run, not just read? Gameplay/UI changes need a
      real browser pass (`qa-browser-engineer`); backend changes need an
      actual request against `lib/db.mjs`'s functions, not just a code read.

## Security (mandatory for anything touching sessions, rewards, or campaigns)

- [ ] Is any win/prize/points decision made server-side only? Reject any
      diff that lets the client compute or assert a win.
- [ ] Are new endpoints idempotent where they mutate state (order IDs,
      redemption IDs)? Check for a unique-index or `ON CONFLICT` pattern
      like `points_ledger_order_uniq` in `supabase/schema.sql`.
- [ ] Do new RPCs that touch `players.order_points` or budgets take a row
      lock (`FOR UPDATE`), matching `resolve_run`'s existing pattern? Race
      conditions on shared balances are a real, previously-identified risk
      class here.
- [ ] Any new secret read from `process.env`, never hardcoded, never logged?
- [ ] Does it touch `WHEEL` or `resolve_run`? If so, read
      `docs/security/reward-wheel-compliance.md` first — there's an open,
      unresolved compliance flag on that exact code path.
- [ ] No new debug/cheat query params or keys that bypass gating or
      credit points client-side, even "for testing" — a prior lineage
      (`fastfood-ninja`) shipped one; don't reintroduce the pattern.

## Maintainability

- [ ] Does new brand/content-specific data belong in `engine/config.js`'s
      constants, not hardcoded inline?
- [ ] Comments explain _why_, not _what_ (match existing style in
      `engine/config.js`, `lib/db.mjs`).
- [ ] No unrelated refactors bundled into a focused change.

## Tests

- [ ] No test suite exists yet project-wide (see `docs/project-inventory.md`
      "Missing tests"). Until one does: was manual verification evidence
      captured (screenshot, curl output, console log) rather than asserted?
- [ ] If this diff is the one that adds the first test tooling, does it
      follow `claimlabs-testing`'s stack recommendation rather than
      introducing a second, competing toolchain later?

## Duplication / architecture

- [ ] Does this duplicate logic that exists in a sibling build
      (`krispy-kreme/`, `fastfood-ninja/`) instead of factoring it toward
      the shared-engine target in `claimlabs-game-architecture`?
- [ ] Does it move the codebase incrementally toward the target
      `games/slice-rush/` structure, or does it entrench the current flat
      layout further? Either is acceptable for a small change — but don't
      actively fight the target structure.

## Unintended changes

- [ ] Branding: does this diff accidentally touch a different client's
      folder (`../krispy-kreme/`, `../fastfood-ninja/`, etc.)?
- [ ] Deploy config: does `.vercel/`, `vercel.json`, or `netlify.toml`
      change unintentionally? (See ADR 0002 — this exact mistake already
      happened once via copy-paste.)
- [ ] Docs: if architecture changed, was `docs/architecture/` or `CLAUDE.md`
      updated in the same change, not left to drift?
