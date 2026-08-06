# Architecture overview — Slice Rush (McDonald's build)

## Current architecture (as-is, 2026-08-06)

```
mcdonalds/
├── engine/        classic global-script canvas game loop
│   ├── config.js   — all tuning + content (CONFIG, BRAND, FOODS, BOMB, WHEEL, DISCOUNT_TIERS)
│   ├── platform.js — mobile/tablet gate + rotate hint
│   ├── audio.js    — synthesized SFX (Web Audio API, zero audio files)
│   └── game.js     — spawning, physics, scoring, combos, power-ups, canvas HUD, scenes
├── src/           newer ES-module app shell (NOT reconciled with engine/)
│   ├── core/router.js, core/store.js
│   ├── pages/*.js  — one per screen (welcome, sign-in, play, rewards, leaderboard, victory, assets)
│   ├── adapters/engine-bridge.js — shims window.UI/window.LoyaltyData for engine/game.js
│   ├── components/ui.js — shared DOM component helpers
│   └── styles/{tokens,base,components,screens}.css
├── api/           Vercel Serverless Functions (thin handlers)
├── netlify/functions/  hand-maintained mirror of api/ for Netlify hosting
├── lib/db.mjs      Supabase/PostgREST client, auth helpers, phone normalization
└── supabase/schema.sql  tables + all business logic as row-locked Postgres RPCs
```

Two things define this architecture more than the folder layout:

1. **The `engine`/`src` seam is real, not just a naming difference.**
   `engine/*.js` are plain `<script>` globals loaded first; `src/main.js`
   loads as an ES module afterward and bridges into them via
   `engine-bridge.js`. They were built at different times by different
   sessions and are **not fully reconciled** — see "Known architectural
   debt" below. Any architecture work should either respect this seam
   explicitly or resolve it deliberately, never paper over it.

2. **All state-changing logic lives in Postgres RPCs, not JS.**
   `api/*.mjs` handlers are intentionally thin (validate → call RPC → shape
   response). The actual decisions — is this run legitimate, does this
   player qualify, what prize do they win, is this points-credit a
   duplicate — happen inside `supabase/schema.sql`'s functions, under row
   locks. This is a good, deliberate boundary; preserve it when extending
   the backend.

## Known architectural debt

- **HUD duplication**: `engine/game.js`'s canvas HUD and `src/pages/
  play.js`'s DOM overlay both render score/lives during a round
  simultaneously (confirmed by screenshot 2026-08-06). Resolving this
  means picking one owner for in-round HUD state — likely `src/` reading
  from a shared event/state bridge that `engine/game.js` emits into,
  rather than each layer tracking its own copy.
- **`src/pages/victory.js` reads a local mock `Store`**, not the real
  round result from `engine/game.js`'s `endGame()`/`LoyaltyData.
  submitRun()`. The `src/` app shell was built before or independently of
  the real backend integration finishing — it needs to be wired to the
  actual result, not sample/placeholder data.
- **Per-client folder duplication instead of shared engine + config**:
  `mcdonalds/`, `krispy-kreme/`, `fastfood-ninja/` each have their own full
  copy of the engine, already diverged in gameplay values and reward
  models. See `docs/product/reskin-model.md` and
  `.claude/skills/claimlabs-configurable-reskins/SKILL.md`.

## Target architecture

```
apps/{player-web, operator-dashboard, api}/
games/slice-rush/src/{scenes,entities,systems,mechanics,ui,audio}/
games/slice-rush/{assets,config,tests}/
packages/{game-runtime, campaign-config, reward-engine, anti-cheat,
          analytics-events, design-system, shared-types, test-utilities}/
database/{migrations, seeds, fixtures}/
```

Migrate incrementally, driven by real tasks, not a big-bang rewrite. A
reasonable extraction order, given what already has natural boundaries:

1. `api/` + `lib/` + `supabase/` → `packages/reward-engine` (already the
   most isolated, best-tested-by-convention boundary).
2. `engine/config.js`'s constants → `packages/campaign-config`, with a
   validated schema (currently unvalidated — a malformed `FOODS` entry
   fails silently to an emoji fallback rather than erroring loudly).
3. Reconcile `engine`/`src` (resolve the HUD duplication and the `Store`
   vs. real-result gap) *before* splitting `engine/game.js` into
   `scenes/entities/systems/mechanics/` — splitting a file that's about to
   be substantially rewritten anyway is wasted motion.
4. Only once a second live client is actually being onboarded: extract the
   shared engine so reskins become config, not folder copies.

See ADRs in `docs/decisions/` for the specific changes already made toward
(or in tension with) this target.
