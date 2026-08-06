---
name: claimlabs-debugging
description: Standard debugging workflow for Slice Rush — reproduce, capture expected vs. actual, inspect logs/state, form competing hypotheses, test them, find root cause, add a regression test, fix, retest, document. Use for any bug investigation, especially before assuming a change caused a symptom.
---

# ClaimLabs debugging workflow

## The workflow

1. **Reproduce.** Actually trigger the bug yourself before theorizing.
2. **Capture expected vs. actual** precisely — not "it's broken," but the
   exact screen state, HUD value, or response body you got vs. wanted.
3. **Inspect logs and state directly** — browser console (`read_console_messages`),
   network requests (`list_network_requests`), server logs
   (`server.py`'s stdout, or Vercel function logs once deployed). Don't
   guess at what the server returned; look.
4. **Form competing hypotheses** — in this codebase specifically, always
   include "is this actually an environment/tooling problem, not an app
   bug" as one hypothesis before spending time on the others. See the case
   study below.
5. **Test each hypothesis** against real evidence, not plausibility alone.
6. **Find root cause** — the deepest fixable point, not the first
   symptom you can suppress.
7. **Add a failing regression test** for it, once a test suite exists
   (`claimlabs-testing`); until then, write down the exact repro steps in
   the commit/PR description or a `docs/decisions/` ADR so it isn't lost.
8. **Fix** the root cause.
9. **Retest** — rerun the exact repro from step 1, don't just re-read the
   diff.
10. **Document durable findings** — if the bug or its cause is
    non-obvious and likely to bite someone again, add it to
    `.claude/agent-memory/known-traps.md`, not just the PR description.

## Worked case study from this project (2026-08-06) — read before assuming a page crash is an app bug

Symptom: the app rendered as a blank red rectangle; browser-automation
tools reported "frame detached" / navigation timeouts.

- **Wrong first hypothesis** (would have been easy to jump to): a bug in
  `src/main.js`'s router or an infinite loop in `engine/game.js`.
- **Actual root cause, found by inspecting network requests, not by
  reading source**: `server.py`'s single-threaded `TCPServer` was refusing
  about half of the ~17 requests the app fires on load, which made
  `src/main.js`'s static ES module imports fail, which threw before the
  router ever initialized.
- **A second, unrelated confound** was present at the same time: this
  machine's antivirus injects a long-polling script into every page,
  which independently caused "network idle" waits to time out — a real
  tooling artifact, not caused by the app at all, and not related to the
  server bug above.
- **Lesson applied**: two different automation backends (Playwright,
  Chrome DevTools MCP) both failed the same way — that ruled out "one
  tool is flaky" and pointed at something environmental or server-side,
  which is what actually inspecting `list_network_requests` confirmed.
  Reading `engine/game.js` line by line would not have found this.

Full record: ADR 0003 (`docs/decisions/`),
`.claude/agent-memory/known-traps.md`.

## Specific to this codebase

- Check `.claude/agent-memory/known-traps.md` **first**, before
  investigating — several classes of "looks like an app bug" have already
  been root-caused once (dev server threading, AV interference, stale
  `.vercel` links, stale docs).
- The `engine`/`src` seam is a common source of "it works in one place but
  not the other" bugs — check both layers before concluding a fix is
  complete.
