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
- **`victory.js` no longer exists.** Win and loss share one
  `src/pages/result.js` (ADR 0010); `/win` survives only as a redirect for
  links already in the wild. It reads the real recorded run, and the reward
  comes from the server via `rewardPanel`.
- **The DOM is the ONLY in-round UI renderer.** The canvas HUD was deleted
  (ADR 0006). The engine pushes changed values via `UI.hud()`; there is no poll
  and no second renderer. Don't add one.
- **Anything over the canvas must not intercept pointers** — see
  `.claude/rules/gameplay.md`. An overlay once made the game unsliceable.
- **Mobile-only, mobile-first.** Canonical frame 390×844; test 375×667,
  393×852, 430×932, then tablet/desktop scale-up. Desktop always shows the
  mobile gate — don't build assuming a real desktop layout is needed
  beyond that gate screen.
- **Respect `prefers-reduced-motion`** — `src/main.js` already reads this
  into `Store.settings().reducedMotion`; extend that pattern for any new
  animated element, don't bypass it.
- **i18n is `src/core/i18n.js`** — EN + AR with RTL, restored in ADR 0010
  after the `src/` rewrite dropped it entirely. Every player-facing string goes
  through `t()`; numbers through `num()` (Arabic uses its own digits). A unit
  test asserts locale parity both ways and matching `{placeholder}` sets, so an
  untranslated key fails the build rather than shipping.
- Compare implementation against the Stitch reference (`stitch-export/`)
  at the same viewport before calling a screen done — see
  `claimlabs-stitch-to-code`.
