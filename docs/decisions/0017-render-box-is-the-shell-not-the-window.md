# 0017 — The render box is the app shell, not the window

Date: 2026-08-12
Status: Accepted

## Context

On a laptop or desktop the canvas overflowed the visible area and the player
saw a cropped, off-centre slice of the play field.

`Platform.viewport()` returned the whole window:

```js
return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
```

`resize()` then sized the stage and the canvas to that box. But the canvas does
not live in the window — `#stage` is absolutely positioned inside `#app`, which
is a phone-shaped column (`max-width: --app-max`, `margin: 0 auto`) with
`overflow: hidden`.

So on a 1920px display the engine sized a **1920px** canvas inside a **480px**
container and the shell clipped away the other three quarters. The visible
quarter was the field's left edge, not its centre, which is why it read as
"the game only fills part of the screen" rather than as a scaling error.

On a phone the two boxes are the same size, which is why this never showed up
on any of the six supported viewports — every one of them is narrower than
`--app-max`.

### Why it was framed as a Phaser bug

The report that opened this work described a fixed-size `Phaser.Game` config
needing `Phaser.Scale.FIT`. There is no Phaser here (ADR 0013 — vanilla canvas,
no framework, no bundler). The mechanism was analogous, though: a renderer
sized from the wrong box, with nothing reconciling it to its container.

## Decision

**1. `Platform.viewport()` measures the element that bounds the canvas.**

It reads `#app`'s client box, falling back to the window only when the shell is
absent or has no layout yet (first paint, or a test mounting the engine
standalone) — a zero-size box would feed a degenerate scale into `resize()`.

**2. The shell is observed, not just the window.**

The render box and the window no longer change together: `#app` is
`height: 100dvh`, so mobile Safari collapsing its toolbar resizes the shell
without a meaningful window resize, and crossing the desktop breakpoint changes
the shell's width while the window's barely moves. A `ResizeObserver` on `#app`
drives `resize()` so the canvas cannot disagree with the box that clips it.

**3. On desktop the shell becomes a real phone frame.**

Above `700px × 700px` the shell is locked to the canonical 390×844 aspect,
scaled to the available height and centred in both axes. Previously it was a
480px-wide, full-window-height column — a 0.44 aspect against a 0.5625 field,
which COVER scaling then cropped hard on both sides.

This keeps the mobile-only product decision intact (ADR 0006): desktop still
shows the device gate, and this frame is what `?play` reveals behind it.
Phones and tablets never satisfy both breakpoint conditions, so all six
supported viewports render exactly as before.

**4. Body-level fixed overlays are pinned to the frame.**

`.offline-bar` and `.spin-overlay` are appended to `<body>`, so `position:
fixed` anchors them to the window. Once the shell stopped filling the window
they detached from it — `.spin-overlay` in particular painted its solid red
across the entire desktop screen. Both are constrained to the frame inside the
desktop media query. `.toast` and `.coach` already centred themselves against
`--app-max` and needed no change.

## Consequences

- The canvas is exactly the shell's size on every viewport, phone or desktop.
- `Platform.viewport()` now depends on the DOM having an `#app` element. The
  fallback keeps the engine usable without one, but the shell is the contract.
- The desktop frame is a presentation change only. No gameplay geometry moved:
  `field.js`'s visible-range and spawn-bounds maths take the viewport as input
  and are unchanged.
- Anything new appended to `<body>` rather than into `#app` must be pinned to
  the frame in the desktop media query, or it will float against the window.

## Verification

`tests/e2e/viewport-audit.spec.js`, in its own `audit` Playwright project so it
can drive desktop viewports the six mobile projects cannot express. It asserts,
at 1440px, 1920px, 768px tablet, iPhone 14 (390×844) and iPhone 15 (393×852),
that the canvas is inside the viewport on every edge, that the document does
not scroll horizontally, that the canvas fills its shell (the half-screen
regression), that it never exceeds it, and that the desktop frame is centred to
within 2px.

Before the fix, at 1440px: canvas 1440px wide inside a 480px shell.
After: canvas and shell both 415px, centred, with the field uncropped.
