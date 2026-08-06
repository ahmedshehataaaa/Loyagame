---
description: Rules for test code (once a suite exists)
globs: ["tests/**", "**/*.test.js", "**/*.test.mjs", "**/*.spec.js", "games/slice-rush/tests/**"]
---

# Tests

- **No test suite exists yet anywhere in this repo** as of 2026-08-06 —
  see `claimlabs-testing` for the recommended stack (Playwright +
  Node's built-in `node --test`) when this becomes the actual task.
- **Never delete or weaken a test to make a build pass.** If a test is
  failing, the failure is either a real bug (fix the code) or the test is
  wrong (fix the test, and say explicitly why the original assertion was
  incorrect — don't just loosen it silently). This is enforced as a
  best-effort check in `.claude/hooks/pre-dangerous-command.js` (flags
  `rm` on test-looking paths) but that hook can't see intent — the real
  enforcement is: don't do it.
- **Reward/session/anti-cheat test cases come from the actual threat
  tables** in `claimlabs-anti-cheat` and `security-adversary`'s exploit
  checklist — a test suite that doesn't cover token replay, race
  conditions on `resolve_run`, and webhook idempotency isn't covering this
  project's actual risk profile, regardless of how much gameplay logic it
  tests.
- **Integration tests hit a real local/staging Supabase instance**, not a
  mock — this project's most important guarantees (row-locking,
  idempotent constraints) are exactly the kind of thing a mocked DB would
  hide. See `claimlabs-database`.
- **A fixed bug gets a regression test** in the same change that fixes it,
  once the suite exists — see `claimlabs-debugging`.
