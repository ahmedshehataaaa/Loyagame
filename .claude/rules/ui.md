---
description: Rules for the DOM/CSS app shell (src/pages, src/components, src/styles)
globs: ['src/pages/**', 'src/components/**', 'src/styles/**']
---

# UI code

- **Use `src/styles/tokens.css`'s existing tokens** — real McDonald's
  brand values (`#DA291C` red, `#FFC72C` gold, `Anton`/`Sora` fonts,
  `--lip-*`/`--glow-*` bevel system), extracted from the current Stitch
  project ("McSlice Rewards Arcade"). Don't inline a new hex value or font
  when a token exists; extend `tokens.css` if a design genuinely needs a
  new one.
- **`src/pages/victory.js` currently reads a mock `Store`**, not the real
  round result from `engine/game.js`. Don't build new features assuming
  `Store` reflects actual gameplay state — verify which is true for the
  specific data you need before relying on it.
- **Don't add a third HUD renderer.** The canvas (`engine/game.js`) and
  the DOM overlay (`src/pages/play.js`) already both draw score/lives
  during a round — a known, unresolved duplication. If your change touches
  in-round UI, either scope around this explicitly or treat resolving it
  as the task (with `lead-architect` sign-off, since it's cross-cutting
  with `gameplay-engineer`'s territory).
- **Mobile-only, mobile-first.** Canonical frame 390×844; test 375×667,
  393×852, 430×932, then tablet/desktop scale-up. Desktop always shows the
  mobile gate — don't build assuming a real desktop layout is needed
  beyond that gate screen.
- **Respect `prefers-reduced-motion`** — `src/main.js` already reads this
  into `Store.settings().reducedMotion`; extend that pattern for any new
  animated element, don't bypass it.
- **RTL/i18n**: no i18n mechanism confirmed wired into `src/` yet (the
  `fastfood-ninja` lineage had one in `_legacy-ui-backup/i18n.js` — check
  whether `src/` has adopted an equivalent before assuming English-only is
  acceptable or building a second, competing i18n system).
- Compare implementation against the Stitch reference (`stitch-export/`)
  at the same viewport before calling a screen done — see
  `claimlabs-stitch-to-code`.
