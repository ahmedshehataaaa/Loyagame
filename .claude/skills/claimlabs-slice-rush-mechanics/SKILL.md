---
name: claimlabs-slice-rush-mechanics
description: Reference for the actual, verified Slice Rush game mechanics as implemented in mcdonalds/engine/ — round timing, bomb loss, scoring, combos, spawning, collisions, difficulty, win/loss states, pause/resume, result submission. Use before changing gameplay, to know what's real vs. what's spec-only.
---

# ClaimLabs Slice Rush mechanics (as implemented, verified 2026-08-06)

This documents what the code actually does. Where the product brief says
something different, it's called out explicitly — do not silently assume
the brief is already implemented.

## Round

- **30 seconds** (`CONFIG.ROUND_TIME`, `engine/config.js`) — changed from
  60s on 2026-08-06, see ADR 0001.
- **2 lives** (`CONFIG.START_LIVES`) — changed from 3 on 2026-08-06.
- Virtual design resolution 1280×720, scaled to fit (landscape).

## Loss condition

`engine/game.js`: `lives--` when a bomb ("Burnt Fries," `BOMB` constant) is
sliced (~line 180); `endGame()` fires at `lives <= 0` (~line 191). With
`START_LIVES: 2`, this is correctly "lose after 2 bombs."

## Win condition — ⚠️ gap between spec and code

The brief says "win by surviving the full 30 seconds." **The code does not
implement a distinct survival-win state.** `endGame()` is called identically
whether the timer expires (`timeLeft <= 0`) or lives hit zero — both just
call `LoyaltyData.submitRun(score, durationMs)`. "Won" (for reward
purposes) is decided server-side by `resolve_run` based on whether score/
order-points cross `WHEEL.pointsThreshold`, **not** by whether the player
survived. If a task assumes survival unlocks something distinct from the
score threshold, that's new work, not a bug fix — write it up with
`claimlabs-feature-planning`.

## Scoring & combos

- Base points per food item, 150–600 (`FOODS` array, `engine/config.js`) —
  deliberately large; a good round lands in the 100k–900k range the
  leaderboard is designed around.
- Combo window 0.45s (`COMBO_WINDOW`) — slices within the window chain;
  missing the window or hitting a bomb resets combo to 0.
- Golden item: ~5% of spawns (`POWERUP.goldenChance`), 3× points
  (`goldenMult`).

## Spawning & difficulty

- Waves spawn on a timer; interval and count ramp over `RAMP_TIME` (50s)
  from easy (`spawn.easyInterval`/`easyCount`) to hard
  (`spawn.hardInterval`/`hardCount`).
- Bomb chance ramps `spawn.bombChanceEasy` (5%) → `spawn.bombChanceHard`
  (16%) over the same window.
- ⚠️ **Known imbalance**: `RAMP_TIME` (50s) now exceeds `ROUND_TIME` (30s)
  after ADR 0001 — the difficulty curve never reaches its "hard" end within
  a round. Not yet rebalanced; flag before assuming current difficulty
  feel is intentional.

## Power-ups

- ⚡ Frenzy: 5s of faster/bigger spawns, no bombs during it.
- ❄️ Freeze: 4s of 35%-speed item motion; the round clock is not slowed,
  only items.
- Both gated by `POWERUP.specialChance` (5% per wave).

## Collisions

Swipe-through detection: a slice registers when the blade **segment**
between two frames passes within a per-item radius of the item's center —
not a tap/point check. See `engine/game.js` for the exact geometry if
touching this.

## Pause/resume

`Game.pauseGame()`/`resumeGame()` exist in the engine's exposed API
(`engine/game.js`'s return object) — behavior not independently
re-verified this session; confirm current behavior before relying on a
description here that might be stale.

## Result submission

`endGame()` → `LoyaltyData.submitRun(score, durationMs)` → `POST
/api/submit-run` → `resolve_run` RPC (row-locked, plausibility-checked,
decides win/prize server-side). See `claimlabs-reward-security`.

## HUD (known duplication)

The canvas HUD in `engine/game.js` and the DOM overlay in
`src/pages/play.js` both render score/lives simultaneously — confirmed by
screenshot, not just code reading. Lives currently render as 🌶️
chili-pepper glyphs (leftover from the original Pasta & Heat build, not
re-themed for McDonald's).
