---
description: Rules for test code (once a suite exists)
globs: ['tests/**', '**/*.test.js', '**/*.test.mjs', '**/*.spec.js', 'games/slice-rush/tests/**']
---

# Tests

- **The suite is Vitest (unit) + Playwright (browser).** 183 unit tests over
  the pure modules in `src/game/`, `src/services/`, `src/campaign/`,
  `src/components/spin-wheel.js`, `src/core/i18n.js` and `src/analytics/`; 732
  browser tests across the six supported viewports. `npm run verify` runs the static gates plus unit tests;
  `npm run test:e2e` runs the browser suite.
- **Prefer a pure module over a browser test.** Headless Chromium throttles
  `requestAnimationFrame` to roughly 1.3fps here, so anything asserting on
  wall-clock round progress is flaky for reasons unrelated to the game. Round
  length, win/loss and the difficulty curve are covered deterministically in
  `tests/unit/`.
- **Browser tests must use REAL input.** Dispatching events at an element
  bypasses hit-testing. That blind spot hid a bug where the play overlay
  swallowed every pointer event and the game could not be sliced at all.
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
