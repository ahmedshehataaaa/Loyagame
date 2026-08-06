---
name: claimlabs-code-review
description: Review workflow for Slice Rush changes — correctness, maintainability, security, tests, duplication, architecture, unintended changes. Use REVIEW.md as the actual checklist; this skill explains when and how to apply it.
---

# ClaimLabs code review

## Use `REVIEW.md` as the checklist

This skill is the *process*; `REVIEW.md` (repo root) is the actual
line-by-line checklist — correctness, security, maintainability, tests,
duplication/architecture, unintended changes. Keep them in sync: if a
review turns up a new recurring failure mode worth checking every time,
add it to `REVIEW.md`, not just this file.

## Who reviews what

- **`lead-architect`** does the final review on every non-trivial change
  before it's reported done — checks scope match, architecture fit,
  evidence quality.
- **`security-adversary`** reviews (adversarially, by trying to break it,
  not just reading it) anything touching sessions, rewards, points, or
  campaign budgets — mandatory, not optional, for that category.
- A human reviews anything crossing the "requires human approval" list in
  CLAUDE.md, regardless of what automated/agent review already happened.

## Review process

1. Read the actual diff, not a summary of it. `git diff` once a repo
   exists; until then, compare the edited file against what was described
   as the plan.
2. Walk `REVIEW.md` section by section — don't skip the security section
   just because the change "looks like" pure UI; check whether it touches
   `WHEEL`, `resolve_run`, session tokens, or points anywhere, even
   incidentally.
3. Check for the specific failure modes this project has already produced
   once: a `.vercel` link accidentally pointing at the wrong project (ADR
   0002), stale docs describing the wrong client (pre-2026-08-06 state),
   a fix applied to `engine/` but not mirrored in `src/` (or vice versa),
   an `api/*.mjs` change not mirrored in `netlify/functions/`.
4. Demand evidence, not assertion. "Verified in browser, screenshot
   attached" or "curl output: ..." — not "this should work now."
5. If the review finds something, the finding goes back to the agent that
   made the change (or the human) — a reviewer does not silently fix
   security-relevant code itself (see `security-adversary`'s tool
   restrictions); other reviewers may fix straightforward issues directly
   if the fix is unambiguous and back in scope.

## Definition-of-done alignment

Don't approve a change that fails any item in CLAUDE.md's Definition of
Done section — acceptance criteria met, targeted checks pass, tests pass
(once they exist), adversarial security review done where relevant, the
game actually driven in a browser for gameplay/UI changes, docs updated
for architecture changes, no cheat keys/secrets/placeholders left behind.
