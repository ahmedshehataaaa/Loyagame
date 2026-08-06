---
description: Rules for assets and configuration files
globs: ["assets/**", "engine/config.js", "src/styles/tokens.css", "manifest.webmanifest", "vercel.json", "netlify.toml", "*.webmanifest"]
---

# Assets & configuration

- **`engine/config.js`'s exported constants are the reskin/tuning
  surface** — `CONFIG`, `BRAND`, `FOODS`, `BOMB`, `SPECIALS`,
  `DISCOUNT_TIERS`, `WHEEL`. Real content changes (menu items, prices,
  colors, prize odds) belong here, not scattered inline elsewhere. See
  `claimlabs-configurable-reskins`.
- **`WHEEL` and `DISCOUNT_TIERS` are security-sensitive content**, not
  cosmetic config — real money exposure. Treat changes here with the same
  review bar as `.claude/rules/security-sensitive.md`, not as a quick
  content edit.
- **`src/styles/tokens.css` is the live, current design-token source**
  (sourced from the "McSlice Rewards Arcade" Stitch project) — extend it,
  don't hand-roll parallel values elsewhere.
- **Known stale assets**: the welcome-screen mascot is still the Pasta &
  Heat rooster-"P" character, not McDonald's-appropriate. Flagged, not
  fixed as of this writing — fix if in scope for the task at hand.
- **`vercel.json`/`netlify.toml`/`.vercel/project.json` changes are
  deploy-config-sensitive**: this project already had one real incident
  (ADR 0002 — `mcdonalds/` silently pointed at Krispy Kreme's live
  project). Any change here should be double-checked against which actual
  project/site it targets before being treated as routine.
- `.claude/hooks/post-edit-check.js` validates `vercel.json` and
  `manifest.webmanifest` as JSON automatically on save — a block from that
  hook means the file is genuinely malformed, not a false positive to
  route around.
