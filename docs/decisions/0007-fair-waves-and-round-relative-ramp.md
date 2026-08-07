# 0007 — Guarantee dodgeable hazards; tie the difficulty ramp to round length

Date: 2026-08-07
Status: Accepted

## Context

Two independent gameplay-fairness defects, both in spawn logic.

**1. Unavoidable hazards.** `spawnWave()` rolled each spawn slot independently:
a bomb with probability `bombChance`, otherwise a food, each at a random x with a
random horizontal velocity. Nothing related the positions. At high difficulty
(up to 4 items, `bombChanceHard: 0.16`) waves that could not be cleared without
slicing a bomb were not merely possible, they were routine. The brief explicitly
forbids "unavoidable bomb collisions or impossible object combinations".

**2. A ramp that never completed.** `RAMP_TIME` was `50` — a leftover from the
60-second round. When `ROUND_TIME` became 30 (ADR 0001) nothing updated the ramp,
so `difficulty()` (`elapsed / RAMP_TIME`) peaked at `30/50 = 0.6`. The final
seconds of a round, which the brief wants to "feel tense but fair", instead
plateaued mid-curve at 60% intensity. This was already flagged as known-unresolved
in `PROGRESS.md` and `.claude/rules/gameplay.md`.

Additionally, launch `vx` came from a random spread rather than a target, so at
portrait width items routinely flew out of the field before the player could
reach them.

## Decision

### Fairness guarantee

`planWave()` in `src/game/wave-planner.js` places hazards **first**, then routes
foods around them:

- At most `spawn.maxBombsPerWave` (1) hazard per wave.
- Every hazard's flight corridor is at least `spawn.bombClearanceFrac` (0.18 of
  field width) from every food corridor in the same wave.
- Foods are placed by rejection sampling; if that fails, a deterministic scan
  finds a provably clear corridor; if none exists, the food is **dropped**. A
  crowded wave degrades to fewer items, never to an unfair one.
- Frenzy waves contain no hazards at all (frenzy is a reward).

A "corridor" is the x-interval an item sweeps while airborne, so clearance is a
statement about the whole flight, not just the launch point.

### Round-relative ramp

`RAMP_TIME` (absolute seconds) is replaced by `RAMP_FRACTION` (0.85). Difficulty
is `elapsed / (RAMP_FRACTION × ROUND_TIME)`, clamped to 1. The curve now completes
with ~4.5s left at any round length, so the finish sits at full intensity rather
than still climbing.

### Bounded launches

Launches solve for a landing target: `vx = (targetX - startX) / flightTime`, with
both endpoints clamped inside `LAUNCH.marginFrac`. Items are guaranteed to stay
on screen.

## Consequences

- Hazards are still frequent at high difficulty — the guarantee is "dodgeable",
  not "rare". A test asserts bombs still appear, so a future change cannot
  satisfy fairness by quietly removing them.
- `bombClearanceFrac` is a difficulty dial: raising it makes waves easier to read
  and reduces effective item density. It belongs in the per-campaign config when
  the brand manifest lands.
- Changing `ROUND_TIME` no longer silently breaks the difficulty curve.

## Verification

`tests/unit/wave-planner.test.js` — 15 tests. The fairness invariant is checked
across 400 seeds × 5 difficulty levels, with a guard asserting the sweep actually
produced hazard/food pairings (so the test cannot pass vacuously).
`tests/unit/ballistics.test.js` — simulates flight with velocity-Verlet and
asserts items land on target and hang for 1.6–2.3s in the portrait field.
