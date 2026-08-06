---
name: claimlabs-performance
description: Performance budgets and profiling approach for Slice Rush as a mobile web game — frame rate, load time, asset size, memory, network usage, rendering. Use alongside the performance-engineer agent for any perf investigation or optimization.
---

# ClaimLabs performance

## Budgets (target — not all independently verified against current build)

- **60fps** on mid-range mobile during active gameplay (stated design
  intent in the inherited `DESIGN.md`; re-verify current actual frame time
  before assuming it's still met).
- **Frame delta clamped** to ≤50ms already in `engine/game.js` (prevents
  tab-switch physics teleport) — a correctness safeguard, not itself a
  perf optimization; don't remove it while chasing frame-time numbers.
- **First-load request count**: currently ~17 near-simultaneous requests
  on page load (5 CSS/JS, 8 item sprites, favicon, icon, manifest) — this
  is a real network-waterfall cost on mobile, worth measuring on a
  throttled connection profile, not just "loads eventually on wifi."

## Where cost actually lives in this app

- **`assets/items/*.png`** — real sprites, unknown current compression
  level; check actual bytes before assuming they're optimized.
- **No bundler** means no code-splitting, minification, or tree-shaking —
  every `.js` file ships as-authored. This is a deliberate current
  constraint (no `package.json`), not an oversight, but it does mean
  "bundle size" work here is really "individual file weight" work.
- **Duplicate HUD rendering** (canvas in `engine/game.js` + DOM overlay in
  `src/pages/play.js`, both active during a round) is redundant paint work
  every frame — quantify before/after if asked to fix the underlying
  duplication, since that's also a correctness fix with a perf angle, not
  purely cosmetic.
- **`server.py`'s no-cache headers** (`Cache-Control: no-store...`) apply
  to every response, correct for local dev but must not leak into whatever
  actually serves production — verify Vercel/Netlify's static-asset caching
  config separately; `server.py` has no bearing on production perf at all.

## Profiling approach

Use Chrome DevTools MCP's `performance_start_trace`/`performance_stop_trace`
and `list_network_requests` against a real running session (local dev, or
better, a preview deployment on real mobile network conditions) — measured
numbers, not estimates from reading file sizes on disk. Report findings as
before/after numbers for whatever metric was targeted (load time, frame
time, request count), tied to a specific change.

## When to loop in `performance-engineer`

Any change touching `engine/game.js`'s render loop or spawn/particle
system, any asset-pipeline decision, or any investigation into "the game
feels janky on phone" reports.
