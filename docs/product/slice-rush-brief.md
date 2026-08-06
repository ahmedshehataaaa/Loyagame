# Product brief — Slice Rush (McDonald's build)

## What it is

A scan-to-play, mobile-first arcade slicing game (Fruit-Ninja-style)
branded per restaurant client, wired into that restaurant's loyalty/
rewards program. Current live client: McDonald's, internal build name
**McSlice Rush**.

## Specified rules vs. what's actually implemented

| Rule | Spec | Code (as of 2026-08-06) |
|---|---|---|
| Round length | 30 seconds | 30 seconds (`ROUND_TIME`, fixed via ADR 0001) |
| Loss condition | Hit 2 bombs | Hit 2 bombs (`START_LIVES: 2`, fixed via ADR 0001) |
| Win condition | Survive the full round | **Not implemented as a distinct state.** Timer expiring and lives hitting zero both call the same `endGame()`. "Won" (for reward purposes) is decided by score vs. the wheel points threshold, server-side — not by survival. This is a real, open gap between the brief and the shipped game — see `claimlabs-slice-rush-mechanics`. |
| Branding | Restaurant-specific | Yes — `engine/config.js`'s `BRAND`/`FOODS`/`BOMB`, real McDonald's menu-item sprites. Some leftovers not yet re-themed (🌶️ chili lives glyph, rooster-P mascot). |
| Rewards | Real discount codes, server-issued | Real, server-decided (`resolve_run` RPC) — but see the reward-model note below, this isn't discount codes anymore. |

## Reward model has changed since the original brief

The original discount-code-tier model (`DISCOUNT_TIERS` — score crosses a
threshold, wins a % -off code) still exists in `engine/config.js` but is
**dead code in the current build** (comment: "dead code in the current
model — kept for parity"). The live model, per a "July 2026 pivot"
documented in the same file, is: real order-points (earned only by
purchasing) accumulate toward a threshold, which unlocks a **prize wheel**
at game-over. This is a materially different mechanic than "discount
codes issued based on game score," and it carries its own open compliance
question — see `docs/security/reward-wheel-compliance.md`. Anyone working
from the original brief's discount-code language should know it's
describing a superseded model.

## Reward security posture (summary — full detail in `claimlabs-reward-security`)

Real prize issuance is server-authoritative, session-tokened, and
row-locked against race conditions. This is the load-bearing security
property of the whole product — see CLAUDE.md's non-negotiables.

## Known gaps between "what a customer would experience" and today's build

- Blank-screen risk if served by an under-provisioned static server (fixed
  for local dev in ADR 0003; verify the actual production host doesn't
  have an equivalent bottleneck).
- Doubled HUD elements visible during a round (see architecture overview).
- Off-brand mascot and lives icon.
- No distinct "you survived!" moment separate from the score-threshold
  reward screen — a player who dies to bombs late in a high-scoring round
  and a player who survives the full 30s with the same score currently see
  functionally the same outcome path.
