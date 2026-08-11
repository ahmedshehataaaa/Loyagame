# 0015 — Pointer Events, and making sure input can actually reach the canvas

Date: 2026-08-11
Status: Accepted

## Context

The game could not be sliced. At all.

`.game-screen` is a full-height flex container laid over the canvas to position
the HUD. With the default `pointer-events: auto` it won the hit test across the
**entire play field**, so `mousedown`/`touchstart` never reached the canvas.
Measured before the fix: **0 slices in 48 real mouse swipes**.

This is the most serious defect found in the whole production-readiness pass,
and it had been present through every prior stage.

### Why every test missed it

The e2e suite dispatched `MouseEvent`s **directly onto the canvas element**:

```js
canvas.dispatchEvent(new MouseEvent('mousedown', { clientX, clientY }));
```

That bypasses hit-testing entirely. The tests proved the engine's slicing
maths — segment-vs-circle, coordinate mapping, scoring — and proved none of it
was reachable. An earlier session note in this repo claiming "slicing works,
score 0 → 500" had exactly the same blind spot.

The lesson generalises: **a synthetic event aimed at the element you hope
handles it cannot tell you whether a player could reach it.**

### A second, size-dependent instance

The `.toast` shown after guest sign-in ("Playing as guest — practice only")
also intercepted pointers. At 390×844 it happened to sit below the action; at
320×568 it landed squarely in the play field and blocked the player's first
seconds of slicing. Exactly the kind of viewport-dependent bug that ships.

## Decision

### Overlays are pointer-transparent by default

`.game-screen` and `.toast` get `pointer-events: none`. Only the things a player
actually presses opt back in: HUD controls, modals, the coach card, the error
state. `.game-hint` and `.game-stake` are informational and never intercept.

### Input is Pointer Events (closes audit G6)

The engine bound `mousedown`/`mousemove`/`mouseup` **and**
`touchstart`/`touchmove`/`touchend` in parallel. Any touch browser emits
compatibility mouse events, so a single swipe ran through both paths, and
neither could follow a finger that left the canvas.

Now one unified stream, with two things that matter for a slicing game
specifically:

- **`setPointerCapture`** — once a swipe starts the canvas keeps receiving
  moves even when the pointer travels over the HUD or off the screen edge.
  Slicing across the top of the field previously stopped dead at the HUD's
  bounding box.
- **`getCoalescedEvents`** — a fast flick can move hundreds of pixels between
  frames, and the browser buffers the intermediate positions. Feeding all of
  them to the segment test is what stops a genuine swipe passing through an
  item unregistered.

A minimal mouse/touch fallback remains for browsers without Pointer Events, so
the game degrades rather than dies. It is not a second first-class path.

## Consequences

- Any future element placed over the canvas must be checked for pointer
  interception. `.claude/rules/gameplay.md` and `ui.md` now say so.
- Secondary mouse buttons no longer start a slice.
- A pointer leaving the window without an `up` event no longer leaves the blade
  stuck "down" and slicing on the next unrelated move (`window.blur` → release).

## Verification

**Measured:** 0 slices in 48 swipes → **250 points in 2 swipes** (real mouse),
**300 in 2** (real touch pointer).

Four regression tests that can actually catch this, across all six viewports:

1. `elementFromPoint` at five points of the play field must return `#game` —
   asserting on what a real finger would hit, not on a dispatched event.
2. A real Playwright **mouse** swipe must score.
3. A real **touch-pointer** swipe must score.
4. The HUD controls must still receive taps — the fix must not take them too.

## Also fixed here

`server.py` swallowed client hang-ups (`ConnectionAbortedError` /
`ConnectionResetError` / `BrokenPipeError`) and raised its listen backlog from
the default 5 to 128. Playwright closes sockets abruptly between navigations,
and the resulting tracebacks were surfacing as intermittent "page never loaded"
failures under the six-viewport run — a flaky harness that undermined every
result it produced.
