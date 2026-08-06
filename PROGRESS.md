# PROGRESS.md — McSlice Rush (McDonald's)

## Current checkpoint — 2026-08-06 (ClaimLabs audit + first fixes)

This file previously held a Krispy Kreme "Glaze Rush" session log — copied
into this folder when the McDonald's build was forked from Krispy Kreme, and
never updated. That log is preserved below under **Prior history** since it's
still accurate about the shared engine's evolution; just not about *this*
folder specifically.

### Where things actually stand

- **Two layers coexist:** the classic `engine/*.js` (config, platform, audio,
  game — real gameplay loop, canvas engine) loaded as globals, plus a newer
  `src/` ES-module app shell (router, store, pages) wired in via
  `src/adapters/engine-bridge.js`. The `src/` layer is mid-refactor — e.g.
  `src/pages/victory.js` currently reads from its own local `Store`, not from
  the actual `engine.js` round result, so the two aren't fully reconciled.
- **Backend is real**, not mocked: Vercel Functions (`api/*.mjs`, mirrored in
  `netlify/functions/`) talk to Supabase Postgres via PostgREST
  (`lib/db.mjs`). `start-run` → `submit-run` uses one-time server tokens;
  `resolve_run` (`supabase/schema.sql`) is row-locked and does the actual
  win/prize decision server-side.
- **Reward model:** a weighted-random prize wheel gated on a real
  order-points threshold (`WHEEL.pointsThreshold`, currently 4000). **This
  conflicts with this project's own design doc**, which flags random wheels
  for real prizes as sweepstakes/gambling risk and calls for a
  deterministic/player-chosen reward instead — see `DESIGN.md` §6. Not fixed
  this session; needs a legal/business decision.
- **Round rules** — just changed this session to match the Slice Rush spec:
  `ROUND_TIME` 60→30s, `START_LIVES` 3→2 (`engine/config.js`). Verified
  against `engine/game.js`: `lives--` on a bomb hit, `endGame()` at
  `lives <= 0`, so "loses after 2 bombs" is now correctly wired.
  ⚠️ **Not yet adjusted:** `RAMP_TIME` is still 50s — longer than the new
  30s round, so the spawn/bomb-chance difficulty curve never reaches its
  "hard" end within a round. Needs a rebalance pass.
- **Vercel:** `mcdonalds/.vercel` was pointing at the same live Vercel
  project as `krispy-kreme/` (`prj_y9kuQXsAAfFLWqqa9dzO6sp6NWu5`, confirmed
  via the Vercel API to have a real production deployment and public
  domains). Detached this session — renamed to
  `.vercel.krispy-kreme-link.bak` — so a deploy from this folder won't
  silently overwrite Krispy Kreme's production site. **A fresh `vercel
  link` (new or existing McDonald's-specific project) is needed before this
  build can be deployed.**
- **Known stale-branding bug:** the in-round HUD still renders lives as
  🌶️ (chili pepper) glyphs — a leftover from the original Pasta & Heat
  build (`engine/game.js`, variable literally named `chilis`). Not fixed
  this session (docs-only pass); needs a real asset/glyph swap.
- **No automated tests exist.** All prior verification (per the log below)
  was done ad-hoc via a throwaway, uncommitted diagnostic HTML harness.

### Next-session TODO (priority order)

1. Resolve the reward-wheel compliance question (`DESIGN.md` §6) — legal/
   business call, not an engineering one.
2. Rebalance `RAMP_TIME` (and spawn/bomb-chance curve) now that `ROUND_TIME`
   is 30s, not 60s.
3. Swap the 🌶️ lives glyph for something on-brand for McDonald's.
4. Reconcile `src/pages/*` with the real `engine.js` round results (currently
   diverging — see `victory.js`).
5. Link `mcdonalds/` to its own Vercel project before any deploy.
6. Stand up an actual automated test suite (Playwright, per the
   ClaimLabs QA requirements) — nothing currently persists across sessions.

---

## Prior history (Krispy Kreme "Glaze Rush" phase — kept for context)

Checkpoint written because the user was closing that chat. Everything below
was already saved to disk at the time (not just in conversation), for the
`krispy-kreme/` folder specifically — this build was later forked from that
state and reskinned for McDonald's.

### Where things stood then (verified working, headless-tested, zero console errors)

1. **DESIGN.md** committed — the locked art direction ("HOT NOW Neon
   Kitchen"), color/type tokens, two-currency rule, compliance-safe reward
   flow, game-feel spec, mobile-shell rules, security must-haves, build
   order.
2. **P0 mobile fullscreen fix** — `100dvh`, `env(safe-area-inset-*)`,
   scrollbar chrome hidden globally. No page scroll on phone sizes.
3. **Game-feel pass 1** (`js/game.js`) — escalating combo names, hero sparkle
   burst + emphasized name/score popup.
4. **Design tokens** added to `:root` in `css/style.css`.
5. **Home screen redesign** — hero sign → order-points number + progress bar
   → dominant PLAY button → compact support row.
6. **Results card redesign** — game score, new-best badge, leaderboard rank,
   separate order-points line (two-currency separation per DESIGN.md §5).
7. **Leaderboard prestige redesign** — grand-prize card, countdown, podium,
   pinned "you" row.
8. **Reward chooser — compliance fix (DESIGN.md §6):** replaced the random
   prize-wheel spin with a **deterministic reward menu**. `endGame()` →
   `UI.showChooser()` → player taps a real product → `LoyaltyData.claimReward
   (key)` → `UI.showReward(prize)`. The old wheel/spin code was left in place
   (dead on the win path) in case the spin animation was wanted purely as
   post-choice presentation.

   *(This is the fix that was later reverted when the McDonald's build
   pivoted back to a random-weighted wheel — see the current checkpoint
   above.)*

### Known small gaps at that time

- `chooseReward` i18n string missing (EN/AR).
- `resolve_run` still did weighted-draw-and-record server-side even though
  the client had moved to player choice — flagged as needing simplification.
- Doughnut artwork was still primitive Canvas-drawn, not illustrated sprites.
- Server-validated anti-cheat for the leaderboard score was still open.
- Point-ownership/redemption security (OTP-at-redemption) was still open.
- No persistent automated QA — verification was ad-hoc headless Chrome +
  a temporary, uncommitted diagnostic harness.
