# 0005 — Extract gameplay maths into pure modules reached via `window.Mechanics`

Date: 2026-08-07
Status: Accepted

## Context

Spawn composition, launch velocities, hit detection and the round rules all
lived inside the `Game` IIFE in `engine/game.js`, closed over mutable engine
state and calling `Math.random()` directly. None of it could be tested without a
canvas, a DOM and a running animation loop — which is why the project had zero
automated tests after months of work, and why three separate correctness bugs
survived (unfair bomb waves, a ramp that never completed, a win rule that
contradicted the spec).

The target architecture in `claimlabs-game-architecture` wants
`systems/`, `mechanics/`, `config/` boundaries. Converting all four `engine/*.js`
files to ES modules at once would reach that faster but risks the one thing in
this repo that demonstrably works: the canvas slicing loop.

## Decision

Extract the **pure** gameplay maths into ES modules under `src/game/`, and reach
them from the classic engine scripts through a `window.Mechanics` namespace
published by `src/game/index.js`.

```
src/game/
  rng.js           seeded + system RNG, lerp/range/pick
  ballistics.js    launch solutions from target apex
  collision.js     segment-vs-circle, corridor gaps
  wave-planner.js  wave composition + the hazard-fairness guarantee
  round-rules.js   win/loss outcome, hazard hits, plausibility bounds
  index.js         publishes window.Mechanics
```

Every function is deterministic and takes an injected `rng`, so tests can seed
it. `engine/game.js` calls `Mechanics.*` at run time.

**Why the global namespace is safe here:** classic `<script>` tags execute
before any `type="module"` code, so the engine cannot `import`. But the engine
only *reads* `Mechanics` inside `startGame()` / `update()` / `spawnWave()`, and
nothing calls those until `src/pages/play.js` mounts — which is module code, and
therefore runs after `src/game/index.js`. The ordering is guaranteed by the
module/script contract, not by luck.

## Consequences

- 49 unit tests now exist where there were none, covering exactly the risk areas
  that had bugs.
- The seeded RNG gives a deterministic testing mode with **no production
  surface**: there is no query param or global that swaps the RNG, so this
  cannot be used to predict wheel outcomes or farm rewards.
- `window.Mechanics` is a transitional seam, not the end state. When the engine
  is converted to ES modules it should `import` these directly and
  `src/game/index.js` should shrink to a plain re-export.
- Two module systems now coexist by design. `.claude/rules/typescript.md`'s
  warning still applies: do not introduce a third.

## Verification

`npm test` — 49 tests across 4 files, all passing.
`npm run lint`, `npm run typecheck` — clean (`Mechanics` is declared for both
ESLint globals and TypeScript via `types/globals.d.ts`).
