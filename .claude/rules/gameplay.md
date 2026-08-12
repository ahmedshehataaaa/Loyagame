---
description: Rules for the core game loop and tuning (engine/*.js)
globs: ['engine/game.js', 'engine/config.js', 'engine/platform.js', 'engine/audio.js']
---

# Gameplay code

- **Never decide or issue a reward here.** This layer computes score and
  calls `LoyaltyData.submitRun(score, durationMs)` — it does not decide
  "won," does not mint a code, does not display a prize that didn't come
  back from the server. See `claimlabs-reward-security`.
- **All tuning lives in `CONFIG`/`BRAND`/`FOODS`/`BOMB`/`WHEEL`/`FX`/`LAUNCH`
  in `config.js`.** Don't hardcode a number in `game.js` that should be a config
  value — that's exactly how `ROUND_TIME`/`START_LIVES` stayed correct and
  centrally editable (see ADR 0001).
- **Difficulty ramps as a FRACTION of the round** (`RAMP_FRACTION`, ADR 0007).
  The old absolute `RAMP_TIME: 50` exceeded a 30s round, so the curve peaked at
  ~0.6 and the tense finish never arrived. Don't reintroduce an absolute ramp:
  changing `ROUND_TIME` must not silently break the curve again.
- **The canvas draws NO HUD** (ADR 0006). It used to, alongside the DOM
  overlay, so both rendered at once and disagreed. `publishState()` only
  publishes values; `src/pages/play.js` is the sole in-round UI renderer.
- **Input is Pointer Events with capture** (ADR 0015). Never rebind parallel
  mouse+touch pairs: a touch browser emits compatibility mouse events, so both
  paths fire for one swipe, and neither can follow a finger off the canvas.
- **Anything laid over the canvas must be pointer-transparent.** `.game-screen`
  once won the hit test across the whole play field and NOTHING could be sliced.
  Check with `elementFromPoint`, not by dispatching events at the canvas —
  dispatching bypasses hit-testing and hid that bug from every test.
- **The render box is the SHELL, not the window** (ADR 0017). `#stage` lives
  inside `#app`, which is a phone-shaped column with `overflow: hidden`, so
  `window.innerWidth` is the wrong number everywhere except an actual phone —
  on desktop it is several times too wide and the shell silently clips the
  difference. Anything computing viewport geometry must go through
  `Platform.viewport()`. **This includes tests**: `field-bounds.spec.js` once
  derived its own expected range from `window.innerWidth` and started failing
  the moment the engine became correct.
- **Anything hooking resize must tolerate running before `window.Mechanics`
  exists.** A `ResizeObserver` delivers an initial callback on observation,
  which in the built bundle lands before the module layer publishes Mechanics —
  `resize()` then throws "Mechanics is not defined" and the boot dies. Dev does
  not reproduce it; `production-build.spec.js` does.
- Frame delta is clamped to ≤50ms — a correctness safeguard for
  tab-switches, not a performance knob; don't remove it while optimizing.
- Verify changes by actually running a round (`npm run dev`) with REAL input,
  not by reading the diff. `npm run test:e2e` covers this; a swipe made by
  dispatching events at the canvas proves nothing about whether a player could
  make it.
