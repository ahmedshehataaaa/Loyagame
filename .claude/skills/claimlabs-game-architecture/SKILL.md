---
name: claimlabs-game-architecture
description: Use when deciding where new gameplay/UI/backend code should live, when reconciling the engine/ vs src/ split, or when migrating any part of Slice Rush toward the target games/slice-rush/ structure. Rules for separating scenes, entities, systems, mechanics, UI, audio, assets, config, networking, rewards, and analytics.
---

# ClaimLabs game architecture

## Current reality (not the target — see below)

`mcdonalds/` is a flat game folder with two coexisting, unreconciled UI
layers:

- **`engine/`** — classic global-script canvas engine. `config.js` (all
  tuning/content), `platform.js` (mobile gate), `audio.js` (synthesized
  SFX), `game.js` (spawning, physics, scoring, combos, power-ups, canvas
  HUD, scene control). This is where "scenes/entities/systems/mechanics"
  actually live today, undifferentiated inside `game.js`.
- **`src/`** — ES-module app shell. `core/router.js` + `core/store.js`,
  `pages/*.js` (one per screen), `components/ui.js`, `styles/*.css`
  (design tokens). This is where "UI" as a separate concern is starting to
  exist, but it isn't finished — `src/pages/victory.js` reads a local mock
  `Store` instead of the real engine result, and the HUD renders twice
  (once from each layer).
- **`api/` + `lib/db.mjs` + `supabase/schema.sql`** — this is already a
  reasonably clean "rewards/networking" boundary; don't blur it by putting
  gameplay logic in `api/` or reward logic in `engine/`.

## Separation rules going forward

- **Gameplay logic** (spawning, collisions, scoring, difficulty) stays in
  `engine/game.js` or, once split, a `systems/`-equivalent — never in
  `src/pages/*.js`.
- **UI/screens** stay in `src/pages/*.js` + `components/` — never draw new
  DOM-owned UI directly inside `engine/game.js`'s canvas loop.
- **Config/content** (brand, menu items, hazards, reward tiers, campaign
  settings) stays in `engine/config.js`'s exported constants — this is the
  reskin surface (`claimlabs-configurable-reskins`), never hardcode
  restaurant-specific values inline in game logic.
- **Rewards/networking** stays server-side (`api/`, `lib/db.mjs`,
  `supabase/schema.sql`) — client code only calls in and displays what
  comes back, never decides a win/prize itself.
- **Audio** stays in `engine/audio.js`'s synthesized-SFX pattern unless a
  real audio-file pipeline is deliberately introduced (that would be an
  ADR-worthy decision, not an incidental one).

## When touching the `engine`/`src` seam

Don't add a third way of doing something that already exists twice (e.g., a
third HUD renderer). Either: (a) scope your change to one layer and
explicitly note the other layer is now more out of sync, or (b) treat
reconciling the two as the task itself, get `lead-architect` sign-off
first since it's cross-cutting, and update `docs/architecture/` when done.

## Migrating toward the target structure

Target (from CLAUDE.md / ClaimLabs' broader plan):
```
games/slice-rush/src/{scenes,entities,systems,mechanics,ui,audio}/
games/slice-rush/{assets,config,tests}/
packages/{game-runtime,campaign-config,reward-engine,anti-cheat,analytics-events,design-system,shared-types,test-utilities}/
```
Migrate incrementally, one seam at a time, and only when a real task
touches that area — don't do a big-bang move. A reasonable order, given
what already has natural boundaries: `api/`+`lib/`+`supabase/` →
`packages/reward-engine` first (already isolated), then extract
`engine/config.js`'s constants → `packages/campaign-config`, then split
`engine/game.js` into `systems/`/`mechanics/` once the `engine`/`src`
reconciliation is done (splitting a file that's about to be rewritten twice
is wasted motion).
