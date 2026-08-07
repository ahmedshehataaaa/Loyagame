---
name: claimlabs-configurable-reskins
description: Use when adapting Slice Rush for a new or existing restaurant client — branding, colors, fonts, menu items, hazards, assets, copy, languages, reward rules, campaign settings, feature flags. Maintains one reusable engine instead of duplicating gameplay code per restaurant.
---

# ClaimLabs configurable reskins

## Current reality: this rule is already half-broken

The intended model is one engine, per-client config. What actually exists
is **one full folder copy per client** — `mcdonalds/`, `krispy-kreme/`, and
`fastfood-ninja/` each have their own complete copy of `engine/game.js`,
and they have already **diverged** (different `ROUND_TIME`/`START_LIVES`
values, different reward models — discount-tier codes in `fastfood-ninja`
vs. a points-threshold wheel in `mcdonalds`/`krispy-kreme`). Don't assume a
gameplay fix in one build is present in another; it isn't, automatically.

**Do not create a sixth folder-copy for a new client.** If a new restaurant
is requested, that's the trigger to actually build the shared-engine +
per-client-config model this skill describes, not to copy `mcdonalds/`
again.

## What already is config-driven (the reskin surface, per build)

`engine/config.js` exports:

- `BRAND` — name, tagline, game name, colors, ink/outline color, knife
  emoji.
- `FOODS` — per-item id, sprite path, points, hit radius, splatter color,
  label.
- `BOMB` — the hazard item (sprite, radius, label). Currently themed as
  "Burnt Fries" for McDonald's; was a generic bomb/different hazard in
  other lineages — confirm what's appropriate per client rather than
  assuming "bomb."
- `DISCOUNT_TIERS` — dead code in the current (`mcdonalds`) points-wheel
  model, live in `fastfood-ninja`'s discount-code model. Two different
  reward models exist across the lineage; know which one a given build
  actually uses before editing tiers.
- `WHEEL` — prize list + odds + points threshold (McDonald's/Krispy Kreme
  model only).
- `CONFIG.ROUND_TIME`/`START_LIVES`/`spawn.*`/`POWERUP.*` — gameplay
  tuning, technically reskinnable but currently drifted per-build rather
  than deliberately customized.

`src/styles/tokens.css` is the equivalent surface for the newer UI layer —
CSS custom properties, not JS constants.

## Rules for a genuine reskin task

1. **Never duplicate `engine/game.js` logic** to reskin — only touch
   `config.js`/`tokens.css`-equivalent content. If a "reskin" request seems
   to need actual gameplay-logic changes (not just content), that's a
   real engine feature, not a reskin — flag it.
2. **Validate config, don't just accept it.** A malformed `FOODS` entry
   (missing sprite, points as a string) should fail loudly in dev, not
   silently degrade to emoji fallback in production. No validation layer
   exists yet for this — worth building before onboarding a second live
   client.
3. **Campaign/reward rules are content, not code**, and they're
   security-sensitive content — `WHEEL.pointsThreshold`, prize weights, and
   `DISCOUNT_TIERS` percentages all affect real money. Changes here should
   go through the same review bar as backend code
   (`backend-reward-engineer` + `security-adversary`), not be treated as a
   cosmetic tweak.
4. **Feature flags**: none exist yet as a formal mechanism (`API.enabled`
   in `CONFIG` is the closest thing — toggles live backend vs. offline
   mock). If a reskin needs to ship with a feature off, that's a real gap
   to fill, not an existing lever to reach for.

## Target end-state

`packages/campaign-config` (per the target architecture in
`claimlabs-game-architecture`) should hold the schema this config
implicitly has today, with per-client instances under something like
`games/slice-rush/config/<client>.json`, validated at load time. Move
toward this incrementally — extracting `mcdonalds/engine/config.js`'s
shape into a documented schema is a reasonable first step, before touching
any other build.
