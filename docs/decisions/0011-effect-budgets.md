# 0011 — Budget every effect; brand the blade; make motion optional

Date: 2026-08-07
Status: Accepted (Stage 6 of the 2026-08-07 audit)

## Context

Audit finding P7: `particles`, `popups` and `halves` were pushed to directly and
grew **without any ceiling** for a whole round. A frenzy wave at high difficulty
could put thousands of particles on screen — costing frame time exactly when the
game is busiest, and burying the items the player is trying to hit.

The brief is explicit on both counts: "controlled particles", "no visual
clutter", "effects that hide gameplay objects" listed under what to avoid, and
"light screen shake only where suitable". The engine used a raw `shake = 26` on
every bomb, heavy enough to make the field hard to re-aim through at the exact
moment the player must.

Two smaller things: the blade trail's bright core was cyan
(`rgba(120,230,255)`) — the most-seen element in the game and the last piece
still wearing the pre-McDonald's palette — and nothing in the engine honoured
`prefers-reduced-motion`, which `src/main.js` was already reading for the DOM.

## Decision

### One emission path, budgeted

`src/game/fx-budget.js` (pure, tested) plus `CONFIG.FX` ceilings. The engine no
longer pushes to an effect array anywhere; everything goes through
`emitParticle` / `emitBurst` / `emitPopup` / `addShake`, so a new effect cannot
accidentally opt out of the budget or of reduced motion.

- **Eviction is "newest wins"** — a full list drops its OLDEST entry. Dropping
  the newest would mean the slice the player just made produced no feedback,
  which is the one effect that must never be skipped; the oldest entries are the
  most faded anyway.
- **Bursts degrade, they do not vanish.** `burstSize()` scales a requested burst
  down as the pool fills, and still emits a legible minimum once it is full.
- **Popups are on a tighter leash than particles** (12 vs 220): text over the
  play field is the effect most able to hide an item. Item-name popups are
  marked `optional` and are the first thing dropped under reduced motion.
- **Shake is clamped at the source** (`maxShake: 14`), so no call site can
  exceed the ceiling by accident. The hero Big Mac gets a 5 — the only place
  shake is used for celebration rather than damage.

### Reduced motion, honoured in the engine

`Platform.reducedMotion()` reads `matchMedia` **live** rather than caching, so a
player changing the OS setting mid-session is honoured on the next frame without
a reload. Under it: particles collapse to ~15% (never zero — going silent would
make the game feel broken rather than calm), shake goes to zero, the bomb flash
softens, and optional popups are dropped.

### Countdown urgency

`Sound.tick()` fires once per second through the final 5, with pitch rising as
the clock runs down — urgency the player can hear while their eyes are on the
items, not the timer. Driven by the second boundary being **crossed**, so it is
frame-rate independent.

### The bomb hit now names the mistake

A `BURNT! -1` / `BURNT OUT!` popup. Losing a life was previously conveyed only
by a heart disappearing from the HUD, which is easy to miss mid-swipe — and it
is the one moment the player must understand.

### Blade

Golden core (`#FFC72C`) instead of cyan, and its length comes from
`CONFIG.FX.bladePoints`.

## Consequences

- Effect volume is now a per-campaign tuning surface, so a lower-end target
  market can ship with smaller ceilings without touching engine code.
- Worst-case per-frame effect work is bounded, which makes the Stage 8
  performance numbers meaningful rather than dependent on what happened to be
  on screen.

## Verification

`tests/unit/fx-budget.test.js` — 21 tests. The cap holds under 5,000 pushes;
eviction is proved to drop the oldest; bursts shrink with headroom and never
reach zero; shake clamps; and the countdown fires exactly 5 times at both 60fps
and 2fps, which is the property a per-frame check would fail.

**A real bug the tests caught:** `shouldTick` was off by one and never fired the
first tick of the window. Gating on `prevTimeLeft <= fromSec` cannot work,
because at the moment that boundary is crossed `prev` is by definition still
just above it. Now judged on the second the clock has just entered.

`portrait-gameplay.spec.js` re-run to confirm the engine still spawns, renders
and registers slices after the emission refactor.
