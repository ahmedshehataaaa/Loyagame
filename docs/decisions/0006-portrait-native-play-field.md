# 0006 — Author the play field in portrait; delete the 90° stage rotation

Date: 2026-08-07
Status: Accepted

## Context

The engine was authored landscape (`CONFIG.WIDTH/HEIGHT = 1280×720`). To "support"
portrait phones it rotated the entire `#stage` 90° in CSS during play, so the
landscape field filled a portrait screen without the player turning the device.

That worked when the whole UI lived on the canvas. It stopped working when the
`src/` ES-module app shell took over screens, because the DOM HUD is **not**
rotated. Observed at 390×844:

- The canvas HUD (score, timer, lives) rendered **sideways down the right edge**.
- The DOM HUD rendered upright at the top.
- Both were visible at once, and they disagreed — the canvas drew lives as `🌶️`
  chillies inherited from the Pasta & Heat build, the DOM drew `❤`.
- The play field was a shallow band with large dead areas.
- Every pointer event needed a swap/flip transform (`lx = cy; ly = VW - cx`)
  that only made sense while the rotation existed.

The brief requires portrait-first mobile play.

## Decision

**Author the field in portrait: `CONFIG.WIDTH/HEIGHT = 720×1280`, and never
rotate the stage.**

- `resize()` sets `transform: none` and scales with `Math.max` (cover) instead of
  `Math.min` (contain), so the field fills the viewport instead of letterboxing.
- `toGame()` reads `canvas.getBoundingClientRect()` and drops the rotation term.
- `Platform.updateRotateHint()` and the orientation branch in `viewport()` are
  deleted — there is no orientation to force or nag about.
- The canvas HUD is **deleted**. `drawHUD()` becomes `publishState()`, which only
  writes values to the canvas dataset for the DOM HUD to read. One owner for
  in-round UI; the chilli glyph disappears with it.

Landscape velocities do not transplant to a portrait field, so ballistics were
re-derived rather than retuned by hand — see ADR 0005 and
`src/game/ballistics.js`. Items are launched by target apex as a fraction of
field height, so the arcs stay correct at any resolution.

## Consequences

- The desktop "phone frame" letterbox is gone; desktop and mobile share one
  layout, which halves the layout surface to keep correct.
- `assets/rotate.jpg` and any rotate-hint styling are now unreferenced (not yet
  deleted — see audit Stage 8 asset purge).
- Because the stage is upright, the DOM HUD can use safe-area insets and real
  fonts, which a rotated canvas could not.

## Verification

Driven in a real browser at 390×844: items render upright and correctly scaled
(screenshot evidence in the audit), a swipe scores (0 → 500, 2 items sliced),
and `getImageData` confirms content spanning the full field width.
`tests/e2e/portrait-gameplay.spec.js` asserts across 320/360/375/390/412/430:
stage transform is `none`, canvas matches the viewport within 1px, no horizontal
overflow, and exactly one of each HUD readout exists.
