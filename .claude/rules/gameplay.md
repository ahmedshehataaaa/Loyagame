---
description: Rules for the core game loop and tuning (engine/*.js)
globs: ["engine/game.js", "engine/config.js", "engine/platform.js", "engine/audio.js"]
---

# Gameplay code

- **Never decide or issue a reward here.** This layer computes score and
  calls `LoyaltyData.submitRun(score, durationMs)` — it does not decide
  "won," does not mint a code, does not display a prize that didn't come
  back from the server. See `claimlabs-reward-security`.
- **All tuning lives in `CONFIG`/`BRAND`/`FOODS`/`BOMB`/`WHEEL`/
  `DISCOUNT_TIERS` in `config.js`.** Don't hardcode a number in `game.js`
  that should be a config value — that's exactly how `ROUND_TIME`/
  `START_LIVES` stayed correct and centrally editable (see ADR 0001).
- **`RAMP_TIME` (50s) currently exceeds `ROUND_TIME` (30s)** — known,
  unresolved imbalance. Don't "fix" it as a drive-by inside an unrelated
  change; it needs its own acceptance criteria (what should the difficulty
  curve feel like at 30s) via `claimlabs-feature-planning`.
- **The HUD renders twice** (canvas here, DOM overlay in
  `src/pages/play.js`). If you touch the canvas HUD, check whether the DOM
  overlay needs the same change, and don't assume fixing one side
  resolves the visible duplication.
- **Lives glyph is currently 🌶️** (chili pepper, `chilis` variable,
  `game.js` ~line 611-616) — known stale branding from the original Pasta
  & Heat build. Fix if in scope; otherwise leave it and don't treat it as
  unrelated to a gameplay change that touches the same function.
- Frame delta is clamped to ≤50ms — a correctness safeguard for
  tab-switches, not a performance knob; don't remove it while optimizing.
- Verify changes by actually running a round (`python3 server.py`,
  `?play&dev&anyday`), not by reading the diff — see
  `claimlabs-slice-rush-mechanics` for exact current values to check
  against.
