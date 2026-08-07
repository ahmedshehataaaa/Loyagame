# 0010 — Merge win/loss into one Result screen; add the missing journey screens; restore Arabic

Date: 2026-08-07
Status: Accepted (Stage 5 of the 2026-08-07 audit)

## Context

The audit's §8 screen-architecture review found the journey incomplete in both
directions: screens that existed but shouldn't be separate, and screens the
journey needs that didn't exist at all.

- **Win was a route (`/win`), loss was a modal on the play screen.** Both needed
  the same four facts — score, personal best, reward status, what next — so this
  was two layouts for one job, and they had already drifted: the loss modal
  reported "how far short of a score target" the player fell, a target that no
  longer existed after ADR 0004.
- **Missing entirely:** loading state, how-to-play, reward wallet, terms and
  eligibility, offline state, error state.
- **The welcome screen answered none of the four questions** a first-time player
  needs (what the game is, how you lose, how long a round is, what you can win).
  It showed the **Pasta & Heat rooster-"P" mascot** from a different client's
  build over roughly 45% empty flat red.
- **Arabic had regressed to nothing.** The pre-refactor build had EN/AR with RTL
  (`_legacy-ui-backup/i18n.js`); the `src/` rewrite dropped it.
- `#/assets`, a dev item-reference screen, sat in the player tab bar.

## Decision

### One Result screen

`/result` replaces `/win` and the loss modal. Win and loss differ by headline,
colour and primary action — not by structure. `/win` is kept as a redirect so
deep links, bookmarks and any printed QR already in the wild still resolve.

### Screens added

| Screen    | Why a screen                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading   | Not a route — an inline shell state in `index.html`, removed on first route paint. Inline because an external stylesheet cannot style the thing that covers the wait for external stylesheets. |
| `/wallet` | Revisited independently of any round; deep-linkable from a receipt.                                                                                                                            |
| `/terms`  | Compliance needs a stable referenceable URL that survives a refresh.                                                                                                                           |

### Overlays, deliberately not screens

- **How-to-play** — a coach card over the first round. A tutorial route is a
  screen players tap past to reach the game, so the instruction arrives when it
  is least wanted and is gone when it would help. Shown once per device, always
  reachable again from welcome, and it pauses the round behind itself so the
  clock does not drain while it is read.
- **Offline** — a sticky strip, not a modal. Being offline stops rewards, not
  play, so it must not interrupt a round. The reward path already fails closed
  on its own; the banner only explains why.
- **Error** — the router's catch renders a recoverable state with a way back.
  Built as DOM nodes rather than an `innerHTML` template so translated copy can
  never be parsed as markup.

### Welcome rebuilt

Copy now states the round length, the loss rule and the prize range, all
interpolated from live config so they cannot drift from the game. The rooster is
replaced by a hero composed from the **real McDonald's item sprites the game
throws**, with a drawn slice stroke — on-brand using assets this build already
owns, and it doubles as a preview of play. No new art was commissioned or
invented.

### Arabic restored as a first-class concern

`src/core/i18n.js`: a flat key map per locale, `t()` with `{placeholder}`
interpolation, document-level `lang`/`dir`, locale-aware number formatting
(Arabic uses its own digit shapes), and a persisted choice detected from the
device on first run. The language switch sits in the welcome header, not in a
settings screen — an Arabic speaker should not have to read English to find it.

Deliberately no ICU/pluralisation engine: the copy is written to avoid needing
one, which is cheaper than carrying a parser for a few dozen strings. A missing
key renders **the key itself**, never blank — a blank looks like a layout bug
and hides the gap.

Reward copy moved out of `reward-state.js` into i18n keyed by status
(`reward.<status>.title`/`.msg`). That keeps the resolver pure and locale-free
and means every failure state gets Arabic for free.

### Navigation

The tab bar is Home / My Rewards / Play / Ranks. `#/assets` stays as a route for
dev and QA but is out of the player nav.

## Consequences

- `Store.lastReward()` is memory-only and the wallet says so, rather than
  implying its list is complete. Full prize history is server-side
  (`wheel_wins`) and needs the Stage 4 follow-up to load.
- Pages read i18n at build time, so the language switch repaints the current
  route via `Router.repaint()`. Cheap here because pages are plain functions.
- `/sign-in` deliberately has no tab bar: a verification step should not offer
  four ways to leave it.
- Screen count: 7 routes → 9. The growth is legal, identity and reward-trust
  surface a commercial build cannot skip; two screens merged and one demoted.

## Two layout bugs found and fixed during this work

1. **The tab bar sat below the fold on every screen.** Pages render it into the
   scrolling route pane after a `.screen` with `min-height: 100%`, so every
   screen was exactly one nav-height too tall and the page scrolled vertically
   to reach the bar. Invisible on first paint, and missed entirely by the
   existing horizontal-overflow checks. Fixed by reserving the nav height and
   making the bar sticky; `journey.spec.js` now asserts vertical fit too.
2. The language switch, unconstrained in a `space-between` header, stretched
   across most of the row.

## Verification

- **83 unit tests** (+14): `i18n.test.js` asserts locale parity in both
  directions, no blank strings, matching placeholder sets between EN and AR
  (so a translation cannot silently drop a `{var}`), RTL flags and number
  formatting. It also caught a real bug — `num('abc')` rendered `NaN` because a
  truthy non-number survives `n || 0`.
- **402 browser tests across 6 viewports**, including a new 34-test
  `journey.spec.js`: the welcome screen must state all four facts, the rooster
  must not return, the coach card must teach all four rules and appear once, win
  and loss must share one layout with different headlines, `/win` must still
  resolve, terms must match live config and disclose the random draw, the wallet
  must never offer in-app redemption, and Arabic must flip direction, translate,
  persist across reload and not break layout.
