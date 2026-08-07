# 0004 — Surviving the round is the win condition; score is leaderboard only

Date: 2026-08-07
Status: Accepted

## Context

Three different rules claimed to decide a win, and they disagreed:

- The product brief and `CLAUDE.md`: a round is won by **surviving the full 30
  seconds**; it is lost by hitting 2 bombs.
- `engine/game.js`: `endGame()` was reached identically by the timer expiring
  and by lives reaching zero. Nothing recorded which had happened.
- `src/adapters/engine-bridge.js`: `won` was computed as `score >= WIN_SCORE`
  (15,000), **in the browser**.

The observable bug: a player who lost their second life at 28s with a score
above 15,000 was shown the victory screen. Conversely a player who survived the
full 30s with a low score was told how many points they were "short".

The HUD reinforced the wrong rule, advertising `TARGET 15,000`.

## Decision

**A round is won by surviving the full round duration. Score does not gate the
win.** Score remains a leaderboard/bragging statistic.

- `src/game/round-rules.js` owns the rule as a pure, tested function.
  `resolveOutcome({livesRemaining, timeLeftSec})` returns `survived` or
  `eliminated`. Ties (lives and clock both hitting zero on the same frame)
  resolve to `eliminated` — the hazard wins.
- `endGame()` derives the outcome from actual round state *before* submitting,
  and passes it along as `{outcome, survived, livesRemaining, ...}`.
- The HUD now reads `SURVIVE 30s`, not a score target.
- The loss modal says `Burnt out!` and explains the two-bomb rule, instead of
  reporting a gap to a threshold that no longer exists.
- `WIN_SCORE` is deleted. `gap` is gone from the try-again path.

This was chosen over "survive AND beat a score" and "survive, but order-points
gate the reward" because it is the rule the brief states, it is the easiest rule
for a first-time player to hold in their head, and it keeps margin pressure out
of the gameplay loop entirely.

## Consequences

- `survived` is a **claim from the client**, not a permission. The server must
  re-derive eligibility. Nothing about this ADR weakens that; see
  `docs/security/reward-wheel-compliance.md` and audit finding S1.
- Score tuning is now free of reward implications, so item point values can be
  balanced for leaderboard spread alone.
- The reward gate remains `WHEEL.pointsThreshold` order-points, unchanged and
  independent of this rule.

## Verification

`tests/unit/round-rules.test.js` — 13 tests, including the exact regression
("a high score does not rescue an eliminated run") and the two-bomb boundary
(one hit survives, two do not).
`tests/e2e/portrait-gameplay.spec.js` — asserts the HUD reads "survive" and not
"target", across six viewports.
