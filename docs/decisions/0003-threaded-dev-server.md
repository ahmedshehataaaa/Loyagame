# ADR 0003: Thread the local dev server

**Date:** 2026-08-06 · **Status:** Accepted

## Context

`server.py` used a plain `socketserver.TCPServer` (single-threaded, small
accept backlog). `index.html` fires a burst of ~17 near-simultaneous
requests on load (5 CSS/JS files, 8 item sprites, favicon, icon, manifest).
Verified via Chrome DevTools MCP network logs: roughly half of that burst
came back `net::ERR_CONNECTION_REFUSED`, **consistently, on every load,
including reloads with a warm cache**. Because `src/main.js` uses static ES
module imports for all page modules, one failed import (e.g.
`src/pages/play.js`) throws during module evaluation, so
`Router.add(...).start()` never runs. The app rendered as a **blank red
rectangle** — not even `router.js`'s own coded error-fallback UI got a
chance to show, since the crash happened before the router initialized.

This made the current build **untestable locally as shipped** — a
functional blocker discovered incidentally while verifying the ADR
0001 round-rules change, not something introduced by that change.

## Decision

`server.py`: replaced the bare `socketserver.TCPServer` with a
`ThreadingMixIn` subclass (`daemon_threads = True`). One-line-class change,
no other behavior altered (still serves the same directory, same
no-cache headers).

## Verification

After the fix: all 17 previously-refused resources returned `200` via
direct `curl` checks; the app was driven end-to-end in a real browser
(Chrome DevTools MCP) — welcome screen rendered correctly, `PLAY NOW`
navigated into a round, and the HUD showed `TIME 30` / two lives icons,
confirming ADR 0001's change is actually live, not just present in source.

## Consequences

- This only fixes **local dev**. Production hosting (Vercel/Netlify static
  CDN) does not have this bottleneck and was never affected.
- Does not fix the separately-discovered HUD-duplication bug (DOM overlay +
  canvas HUD both rendering at once) — that's an app-code reconciliation
  issue, tracked in `docs/project-inventory.md`, not a server issue.
