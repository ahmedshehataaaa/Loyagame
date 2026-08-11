---
description: Rules for assets and configuration files
globs:
  [
    'assets/**',
    'engine/config.js',
    'src/styles/tokens.css',
    'manifest.webmanifest',
    'vercel.json',
    'netlify.toml',
    '*.webmanifest',
  ]
---

# Assets & configuration

- **Per-restaurant content belongs in a CAMPAIGN MANIFEST**
  (`campaigns/<id>.json`, ADR 0012), not in `engine/config.js`. Manifests are
  schema-validated in CI and at load. `engine/config.js` is now the TUNING and
  FALLBACK surface — gravity, spawn curve, effect budgets, and a complete
  working McDonald's block so the game boots with no manifest at all.
- **`DISCOUNT_TIERS` was deleted** (ADR 0008): dead since the July 2026 pivot
  and two reward models out of date. Recover from tag `baseline-2026-08-07` if
  a discount-tier model is ever revived.
- **`WHEEL` and a manifest's `rewards` block are security-sensitive
  content**, not cosmetic config — real money exposure. Same review bar as
  `.claude/rules/security-sensitive.md`, not a quick content edit.
- **`src/styles/tokens.css` is the live, current design-token source**
  (sourced from the "McSlice Rewards Arcade" Stitch project) — extend it,
  don't hand-roll parallel values elsewhere.
- **The rooster mascot is gone** (ADR 0010). The welcome hero is composed from
  the real McDonald's item sprites the game throws. `assets/` was also purged of
  1.19 MB of unreferenced pre-refactor mockups (ADR 0013) — don't reintroduce an
  asset nothing loads; a test asserts the old ones stay out of `dist/`.
- **`vercel.json`/`netlify.toml`/`.vercel/project.json` changes are
  deploy-config-sensitive**: this project already had one real incident
  (ADR 0002 — `mcdonalds/` silently pointed at Krispy Kreme's live
  project). Any change here should be double-checked against which actual
  project/site it targets before being treated as routine.
- `.claude/hooks/post-edit-check.js` validates `vercel.json` and
  `manifest.webmanifest` as JSON automatically on save — a block from that
  hook means the file is genuinely malformed, not a false positive to
  route around.
