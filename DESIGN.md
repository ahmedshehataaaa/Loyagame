# DESIGN.md — McSlice Rush (McDonald's)

The single source of truth for how this game looks, feels, and behaves.
Every UI/gameplay change should conform to this file. When something here
conflicts with existing code, this file wins and the code is updated.

> **Provenance note (2026-08-06):** this build was forked from the shared
> Slicy-P engine (originally Nashville Pasta & Heat), by way of an
> intermediate Krispy Kreme "Glaze Rush" reskin. This document was rewritten
> from the Krispy Kreme version to match this build's actual current state.
> Sections 7–15 (screen inventory, game feel, mobile shell, security,
> non-goals, build order) are largely brand-agnostic engineering guidance
> carried forward as-is where still accurate; anything doughnut/glaze-specific
> has been re-pointed at the real McDonald's roster. Flag anything below that
> drifts from the code — this doc has been wrong before.

Status: `src/` ES-module app shell is being layered over the classic
`engine/*.js` game loop (see `README.md`). Visual layer + backend are further
along than the original Slicy-P prototype — a real Supabase-backed API exists,
not just `localStorage` mocks.

---

## 1. Product in one line

A scan-to-play, mobile-first **arcade slicing game** that lives inside a
McDonald's: swipe to slice real menu items for score, earn real
**order-points** by purchasing, and unlock rewards. Internal name: **McSlice
Rush**.

## 2. Art direction

- **Mood:** McDonald's arcade — bold red/gold, thick-outline "arcade juicy"
  comic style, high contrast. Sourced from the Stitch project **"McSlice
  Rewards Arcade"** (`stitch-export/`), which is the actual current design
  reference — check there before inventing new UI, not this doc's prose.
- **Hero item:** Big Mac® (`hero: true` in `engine/config.js`'s `FOODS`) gets
  the signature sparkle burst, even though McFlurry scores slightly higher.
- **Not this:** flat radial-gradient backgrounds, generic rounded rectangles
  of equal weight, system emoji as final art (sprites exist per item —
  `assets/items/*.png` — emoji glyphs are fallback-only).

## 3. Color tokens (live — `src/styles/tokens.css`)

```
--c-primary:        #DA291C   McDonald's red — page ground
--c-primary-dark:   #A81A10   pressed edges / bevel lips
--c-secondary:      #FFC72C   golden yellow — CTA, currency
--c-secondary-dark: #C8930A   bevel lip under yellow
--c-ink:             #27251F  structural outline / heading
--c-surface:        #FFF8F6   card paper
```

These are the real, currently-shipping tokens — single source of truth,
extracted from the Stitch project. Do not hand-roll new colors per screen.

## 4. Typography

- **Display / HUD numbers:** `Anton` (per `tokens.css` `--font-display`,
  falling back to `Sora`/system-ui).
- **Body:** `Sora`.
- Numbers that matter (score, points, timer, lives) are BIG — typography is
  part of the HUD, not hidden in cream boxes.

## 5. Two currencies — keep them visually separate, always

Customers must never confuse them.

|                | GAME SCORE                        | ORDER POINTS                  |
| -------------- | --------------------------------- | ----------------------------- |
| Earned by      | slicing skill                     | real purchases only (Foodics) |
| Spent/used for | leaderboard rank, bragging rights | unlocking the reward wheel    |

Rule: playing better must **never** look like it earns purchase points.

## 6. Reward flow — ⚠️ OPEN COMPLIANCE FLAG, not resolved

**This section documents a live conflict between design intent and shipped
code. Do not treat the current behavior as approved — it needs a legal/business
decision, not another silent code change.**

The original rule (written during the Krispy Kreme phase, and still the
better-informed position): **do not** implement "spend order-points on a
random wheel for real-value prizes" — that risks sweepstakes/gambling
classification. The correct flow is deterministic / player-chosen:

```
N ORDER POINTS  →  THRESHOLD REACHED  →  CHOOSE YOUR REWARD
```

A spinning selector is fine **only as presentation after the reward is
already assigned/chosen** — never as the thing deciding the prize.

**What's actually shipping today:** `engine/config.js`'s `WHEEL.prizes` array
assigns weighted random odds (28% down to 0.2%), and `supabase/schema.sql`'s
`resolve_run` RPC performs a real **server-side weighted random draw** to pick
the prize. This is the opposite of the rule above. Project history
(`PROGRESS.md`, prior session) shows a deterministic `UI.showChooser()` flow
was already built once, specifically to fix this — then reverted back to the
random wheel in a later pivot.

**Do not build a real-money version of this on the wheel model without a
compliance sign-off.** Until resolved, treat this as blocking for any launch
involving real prize value at the current point thresholds.

## 7. Screen inventory & hierarchy

Mobile-first canonical frame: **390 × 844** (test 375×667, 393×852, 430×932,
then tablet/desktop scale-up). Desktop scales the phone experience.

- **Home** — order-point progress (number + bar toward `WHEEL.pointsThreshold`),
  dominant **PLAY**, supporting row: best score, rewards/leaderboard nav.
- **Countdown** — `3 · 2 · 1 · SLICE!`.
- **Gameplay** — canvas fills the screen; HUD typography integrated (score,
  30s timer, lives, combo).
- **Results / Victory** — final score, NEW BEST, items sliced, points earned.
- **Leaderboard** — champion card, medal top-3, your row pinned.
- **Rewards** — wheel/chooser screen (see §6's open flag).
- **Sign-in / Welcome** — identity + entry into the loop.

## 8. Game feel spec (where most effort goes)

Every slice fires several things at once:

- **Swipe ribbon** trail following the finger, fading 120–250ms.
- **Split:** whole → two halves rotate apart under gravity (bake-then-clip
  along the real cut angle — already implemented, keep it).
- **Particles:** product-tinted (per-food `juice` color in `FOODS`) from a
  reused particle pool (no per-frame alloc).
- **Score burst:** `+points` floats up & fades; combos multiply visibly.
- **Combos are emotional:** escalating combo names, background brightens &
  trail intensifies with the multiplier.
- **Big Mac® is iconic** (the `hero` item): sparkle burst + emphasized
  name/score popup.
- **Hazard (Burnt Fries):** must read "DON'T TOUCH" pre-attentively —
  charred/dark, pulsing red danger ring; on hit: screen shake, red flash, a
  life lost, punishment short (never interrupts flow).
- **Lives:** currently drawn as **🌶️ chili-pepper glyphs** in
  `engine/game.js` (`chilis` variable, line ~611–616) — a direct leftover
  from the original Pasta & Heat build, never re-themed for McDonald's. This
  is a visible on-brand bug, not a design choice; flagged here, not fixed
  (docs-only pass).
- Target **60 FPS on mid-range phones.** Canvas for gameplay, DOM for UI, no
  DOM writes per animation frame.

## 9. Audio

100% synthesized via Web Audio API (`engine/audio.js`) — zero audio files
ship. UI tap, slice whoosh, combo chime, bomb boom, reward fanfare, game-over
tone. Muted-until-first-interaction; visible mute toggle in the HUD.

## 10. Motion / spacing / components (design system)

Themeable components: `Button, Card, ProgressBar, Modal, HUD, Nav,
LeaderboardRow, RewardCard` (see `src/components/ui.js`,
`src/styles/{tokens,components,screens,base}.css`).
Touch targets ≥ 44px. Buttons animate on press. No zero-feedback taps.

## 11. Mobile shell rules (P0, art-agnostic)

- Shell is `100dvh × 100vw`, `position:fixed; inset:0; overflow:hidden;
touch-action:none; overscroll-behavior:none`.
- Respect `env(safe-area-inset-*)` on UI screens (notch/home-bar).
- No visible scrollbars — long screens scroll _inside_ their own container,
  never the page.
- No pull-to-refresh, no text selection, no pinch-zoom during play.

## 12. White-label / engine rules (long-term)

**One engine, per-client config — do not fork per restaurant.** This is
already partially true: `engine/config.js`'s `CONFIG`/`BRAND`/`FOODS`/`BOMB`
constants are the reskin surface between this build, Krispy Kreme, and
Slicy-P. Target structure per the ClaimLabs architecture:

```
games/slice-rush/{engine shared}, campaign config per client, assets per client
```

Each menu item ships as: `sprite (whole), points, hit radius, splatter color,
label` (already the `FOODS` shape) — prefer real sprites over emoji, already
the case here (`assets/items/*.png`).

## 13. Security (must-haves before real prizes at scale)

Status against this build, verified against the actual code (not aspirational):

- **Score anti-cheat:** ✅ partial — server issues a one-time `token` at
  `start-run`, `submit-run` requires it, `resolve_run` row-locks the run and
  validates duration/plausible-score bounds server-side (`min_run_ms`,
  `max_plausible_score` in `settings`). ⚠️ Not yet: full slice-event streaming
  - server replay — the server trusts the final score/duration pair within
    bounds, not a move-by-move replay.
- **Point ownership:** ✅ order-points are credited only via the Foodics/POS
  webhook (`api/pos-credit.mjs`), never client-writable.
- **Foodics → backend only:** ✅ webhook secret verified via constant-time
  comparison (`lib/db.mjs`'s `isPosCaller`); ⚠️ idempotency/dedupe on
  transaction IDs not independently re-verified this pass — check
  `credit_order_points` in `supabase/schema.sql` before relying on it for a
  real launch.
- **Reward issuance:** ✅ server-decided (`resolve_run`), not client-side —
  but see §6's open compliance flag on _how_ it decides.

## 14. Non-goals (do NOT add)

No XP/levels/coins/gems/badges/streaks/avatars/shops/third currency. Protect
the core loop: **SCAN → PLAY → SCORE → ORDER → UNLOCK REWARD.** Make those
five incredible before adding anything.

## 15. Build order (effort allocation, current state)

1. ✅ Mobile fullscreen / remove overflow
2. ✅ Design-token system + core components (`src/styles/`)
3. ⏳ Item artwork — real sprites exist (`assets/items/*.png`), quality pass
   not independently verified this session
4. ✅ Gameplay physics + slicing feedback (ramp/combo/power-ups all present)
5. ⏳ Home → Results → Leaderboard — `src/pages/*` exist, wiring to the real
   `engine`/`LoyaltyData` flow vs. the newer `Store` mock is not fully
   reconciled yet (see `src/pages/victory.js` — reads from a local `Store`,
   not from the actual `engine.js` `endGame()`/`submitRun()` result)
6. ✅ Sound + particles + combos
7. ⏳ Backend hardening — mostly done (see §13), gaps noted above
8. ❌ Automated QA — no test suite exists (`PROGRESS.md` notes prior sessions
   verified ad-hoc via a throwaway, uncommitted diagnostic harness)
