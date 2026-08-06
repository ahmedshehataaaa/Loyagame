# ADR 0001: Round time 30s, lives 2 (bomb-loss at 2 hits)

**Date:** 2026-08-06 · **Status:** Accepted

## Context

Every build in the Slice Rush lineage (`fastfood-ninja`, `krispy-kreme`,
and `mcdonalds` before this change) shipped with `ROUND_TIME: 60` and
`START_LIVES: 3`. The ClaimLabs product brief specifies 30-second rounds
and a 2-bomb loss condition. This is a real, confirmed discrepancy — not a
misreading — verified by reading `engine/config.js` and `engine/game.js`
directly.

## Decision

Changed `mcdonalds/engine/config.js`: `ROUND_TIME` 60→30, `START_LIVES`
3→2. Confirmed against `engine/game.js`'s loss logic (`lives--` on bomb hit,
`endGame()` at `lives <= 0`) that "lose after 2 bombs" is correctly wired
with these values — no other code changes were needed for the numeric spec
to take effect.

Verified live in a running browser: HUD shows `TIME 30` and two lives icons
at round start (see `PROGRESS.md`).

## Consequences

- `RAMP_TIME` (spawn/bomb-chance difficulty curve) is still 50s —
  now longer than the round itself. The difficulty curve no longer reaches
  its "hard" end within a round. **Not rebalanced yet** — open follow-up.
- "Survive to win" is still not implemented as a distinct state from the
  wheel-threshold win condition (see `docs/project-inventory.md`,
  "Incomplete features"). Changing the round length doesn't change this gap.
- `krispy-kreme/` and `fastfood-ninja/` were **not** changed — this decision
  applies only to `mcdonalds/`, since each reskin currently owns its own
  `config.js` copy (see `claimlabs-configurable-reskins` skill for why this
  should eventually be shared config, not per-fork duplication).
