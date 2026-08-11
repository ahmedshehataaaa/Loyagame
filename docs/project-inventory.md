# Project Inventory — Slice Rush (McSlice Rush, McDonald's build)

> **Updated 2026-08-11.** The 2026-08-07 audit and its ten remediation stages
> are complete. Several findings recorded below as OPEN have since been fixed;
> each is annotated inline with the ADR that closed it. Sections describing the
> pre-remediation state are kept deliberately — this file is the record of what
> was found, and deleting it would erase the reasoning. **`PROGRESS.md` is the
> current-state summary; read that first.**
>
> Closed since the original audit:
>
> - Backend orphaned / client-authoritative rewards (S1) → **ADR 0009**
> - No survival win state → **ADR 0004**
> - `RAMP_TIME` exceeding the round → **ADR 0007**
> - Doubled HUD and the 🌶️ lives glyph → **ADR 0006**
> - Off-brand rooster mascot → **ADR 0010**
> - No test suite → 157 unit + 654 browser tests
> - No `package.json` / no tooling → full toolchain + CI
> - Unbounded effect arrays (P7) → **ADR 0011**
> - Unreferenced 1.19 MB of assets, broken PWA (P1–P5) → **ADR 0013**
>
> Found _after_ the audit and fixed: **the game could not be sliced at all** —
> an overlay swallowed every pointer event (**ADR 0015**).
>
> Still open: no integration test against a real database; reward-wheel
> compliance sign-off; unverified identity; rate limiting; RLS verification.
> See `PROGRESS.md` → "Still open, and why".

Audit date: 2026-08-06. This is a point-in-time snapshot — re-verify file
paths and line numbers against current code before trusting them, per
[claimlabs-project-discovery](../.claude/skills/claimlabs-project-discovery/SKILL.md).

## Locations searched

- `C:\Users\user\` (home directory) and all direct subdirectories, excluding
  `AppData/`, `.cache/`, `node_modules/`, `.git/` (none existed anywhere
  under home).
- `C:\Users\user\Desktop\first project\` and every subfolder (the actual
  find location).
- `C:\Users\user\Downloads\` (design-export zips, pitch decks).
- `C:\Users\user\dough-or-die\` — a **different, unrelated** game ("Dough or
  Die", donut-themed) found during the search; not Slice Rush, ruled out.
- Searched by filename/content for: `slice`, `rush`, `claimlab`, `mcdonald`,
  `fries`, plus later targeted greps for `START_LIVES`, `ROUND_TIME`,
  `resolve_run`, `WHEEL`, service-role keys, and debug/cheat hooks.

## Repositories found

**No Git repository exists anywhere in scope.** `git status` fails with "not
a git repository" both at `Desktop/first project/` and inside every build
folder, including `mcdonalds/`. All version history below is inferred from
filesystem mtimes and in-file comments, not commits. This is a blocker for
the GitHub connector (branches/PRs need a repo to exist first) — see
"Missing / blockers".

## Versions found

All under `C:\Users\user\Desktop\first project\`:

| Folder                                                                         | Brand                                              | Round rules (code)                          | Recency                                                                                                          | Verdict                                                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **`mcdonalds/`**                                                               | McDonald's, internal name **McSlice Rush**         | 30s / 2 lives (fixed 2026-08-06, was 60s/3) | Newest by ~6.6 days vs. everything else; actively being refactored (`src/` ES-module layer added over `engine/`) | **Source of truth**                                                                |
| `krispy-kreme/`                                                                | Krispy Kreme "Glaze Rush"                          | 60s / 3 lives, wheel reward model           | `mcdonalds/` was forked from this state                                                                          | Parent lineage, not current                                                        |
| `krispy-kreme.backup-20260725-172931/`, `krispy-kreme.backup-20260725-184929/` | Krispy Kreme                                       | —                                           | Timestamped pre-cleanup backups                                                                                  | Untouched, inactive                                                                |
| `fastfood-ninja/`                                                              | Nashville Pasta & Heat — "Slicy-P" / "Pasta Ninja" | 60s / 3 lives, discount-tier codes          | Original engine all reskins descend from, per its own `HANDOFF.md`                                               | Historical reference for core engine intent                                        |
| `slicy-p-deploy/`, `slicy-p-ui/`                                               | Slicy-P                                            | —                                           | Static export snapshots of `fastfood-ninja/`, Aug 1 2026                                                         | Superseded                                                                         |
| `pasta-react/`                                                                 | Slicy-P                                            | —                                           | React/Tailwind UI-only rebuild, "does not share the loyalty logic" per its own docs                              | Dead-end experiment, not wired to any backend                                      |
| `Downloads/stitch_mcslice_rewards_arcade*.zip` (×10)                           | McDonald's                                         | —                                           | Stitch design-tool exports, Aug 1–4 2026                                                                         | Design source material (`mcdonalds/stitch-export/` is the extracted, in-repo copy) |
| `Downloads/ClaimLabs-Pitch-Deck*.pdf` (×3)                                     | ClaimLabs                                          | —                                           | Business collateral                                                                                              | Not code                                                                           |

## Source-of-truth recommendation

**`C:\Users\user\Desktop\first project\mcdonalds\`.** Confirmed by:
recency (newest files by ~6.6 days), correct current branding
(`engine/config.js`'s `BRAND.name === "McDonald's"`, real menu-item sprites
in `assets/items/`), a real (non-mocked) backend, and the only build with an
in-progress migration toward a modular `src/` architecture — the direction
this whole Claude Code system should reinforce, not undo.

## Current stack

- **Frontend:** two coexisting layers, not yet reconciled (see "Incomplete
  features"):
  - `engine/*.js` — classic global-IIFE scripts (`config.js`, `platform.js`,
    `audio.js`, `game.js`): the real Canvas 2D game loop, spawning, physics,
    scoring, combos, power-ups.
  - `src/` — newer ES-module app shell: `core/{router,store}.js`,
    `pages/*.js`, `adapters/engine-bridge.js`, `components/ui.js`,
    `styles/{tokens,base,components,screens}.css`.
  - No bundler, no `package.json`, no npm dependencies anywhere in this
    build — both layers ship as raw files.
- **Backend:** Vercel Serverless Functions (`api/*.mjs`), mirrored for
  Netlify (`netlify/functions/`), talking to **Supabase Postgres via
  PostgREST** (`lib/db.mjs`, `supabase/schema.sql`).
- **Deploy targets:** `vercel.json` + (until 2026-08-06) a `.vercel/`
  project link that pointed at Krispy Kreme's live project — detached this
  session, see Decisions.
- **PWA:** `manifest.webmanifest` + `sw.js` (cache-first app shell).
- **Local dev:** `server.py`, a stdlib `http.server` static file server
  (fixed 2026-08-06 to use `ThreadingMixIn` — see Decisions).

## Current architecture

```
mcdonalds/
├── index.html          # loads engine/*.js as globals, then src/main.js as an ES module
├── engine/              # game loop: config.js, platform.js, audio.js, game.js
├── src/                 # app shell: core/{router,store}.js, pages/*.js, adapters/, components/, styles/
├── api/                 # Vercel functions: start-run, submit-run, pos-credit, admin-*, register, profile...
├── netlify/functions/    # mirror of api/ for Netlify hosting
├── lib/db.mjs            # shared Supabase/PostgREST helper, admin auth, phone normalization
├── supabase/schema.sql   # players, points_ledger, runs, wheel_wins, settings tables + RPCs
├── assets/               # McDonald's item sprites, mascot (stale — see risks), brand-logo
├── stitch-export/        # Stitch design references ("McSlice Rewards Arcade")
└── _legacy-ui-backup/    # retired pre-refactor UI, kept for reference, not shipped
```

Does not yet match the target `apps/ / games/slice-rush/ / packages/` layout
— it's a single flat game folder with the right _seams_ (`engine` vs `src`
vs `api` vs `supabase`) to migrate incrementally. See
[claimlabs-game-architecture](../.claude/skills/claimlabs-game-architecture/SKILL.md).

## Working features (verified, not just read)

- **Core slicing gameplay**: spawning/physics/combos/power-ups/haptics —
  loaded and playable end-to-end in a real browser test this session.
  Round timer and lives HUD confirmed showing **30 / 🌶️🌶️** live after the
  2026-08-06 config fix (screenshot evidence in `PROGRESS.md`).
- **Server-authoritative round resolution**: `start-run` issues a one-time
  token, `submit-run` → `resolve_run` RPC row-locks the run
  (`FOR UPDATE`, `supabase/schema.sql` lines ~385, 401) and validates
  duration/plausible-score bounds server-side before deciding the outcome.
  Rewards are not decided client-side.
- **POS point-crediting**: `api/pos-credit.mjs`, secret-verified via
  constant-time comparison (`lib/db.mjs`'s `isPosCaller`), never
  client-writable.
- **Admin dashboard**: `admin.html` + `admin-*` functions for stats,
  players, redemptions, engagement.

## Incomplete features

- **`src/` app shell not reconciled with `engine/` game state.**
  `src/pages/victory.js` reads from its own local `Store`, not the actual
  round result from `engine/game.js`'s `endGame()`. Confirmed visually this
  session: **the in-round HUD is doubled** — the DOM overlay from
  `src/pages/play.js` and the canvas HUD from `engine/game.js` both render
  their own score/lives indicators simultaneously, overlapping.
- **No "survive the round = win" state.** Per the brief, winning should mean
  surviving the full 30s. In the actual code, `endGame()` treats hitting 0
  lives and the timer expiring identically — both just call
  `LoyaltyData.submitRun()`, and "won" is defined purely by whether the
  score/order-points cross `WHEEL.pointsThreshold`, not by survival. This is
  a real gap between the documented spec and shipped behavior worth a
  product decision, not a silent code change.
- **`RAMP_TIME` (50s) now exceeds `ROUND_TIME` (30s)** after the round-time
  fix — the spawn/bomb-chance difficulty curve never reaches its "hard" end
  within a round. Flagged, not rebalanced.
- Item artwork quality and full illustrated-sprite pass not independently
  verified this session (sprites exist, quality unconfirmed).

## Duplicate / abandoned code

- `_legacy-ui-backup/` — retired pre-refactor UI (admin.js, ui.js, theme.js,
  etc.), explicitly not shipped, kept for reference only.
- `krispy-kreme.backup-*` (×2) — untouched historical snapshots, safe to
  leave alone.
- `pasta-react/` — dead-end React rebuild, UI-only, never wired to a
  backend; do not extend it.
- Root-level `index.html` (in `Desktop/first project/`, one level above all
  builds) — an unrelated old "GoalRush" game per `fastfood-ninja/HANDOFF.md`;
  leave it, it is not part of any Slice Rush lineage.
- Old wheel/spin UI (`showWheel`, `spinWheel`, `#screen-wheel`) referenced in
  `krispy-kreme/PROGRESS.md` as dead-on-the-win-path code kept for possible
  reuse — verify whether it still exists in `mcdonalds/` before assuming
  either way.

## Security-critical findings

1. **[RESOLVED 2026-08-06]** `mcdonalds/.vercel/project.json` pointed at the
   same live Vercel project as `krispy-kreme/`
   (`prj_y9kuQXsAAfFLWqqa9dzO6sp6NWu5`, confirmed via the Vercel API to have
   a real production deployment and public domains). A deploy from
   `mcdonalds/` would have silently overwritten Krispy Kreme's production
   site. Detached — folder renamed to `.vercel.krispy-kreme-link.bak`. **A
   fresh, correctly-named Vercel project link is required before any
   deploy of this build.**
2. **[OPEN — needs a legal/business decision, not an engineering fix]** The
   reward wheel (`engine/config.js`'s `WHEEL.prizes`, weighted 28% down to
   0.2%) is decided by a **server-side weighted random draw**
   (`resolve_run` in `supabase/schema.sql`) for **real-value prizes**. This
   is exactly what this project's own inherited `DESIGN.md` (from the
   Krispy Kreme phase) explicitly warned against as sweepstakes/gambling
   risk, and which a prior session had already fixed once with a
   deterministic, player-chosen reward flow before it was reverted in a
   later "July 2026 pivot." See `docs/security/reward-wheel-compliance.md`.
3. Server-side score validation is **bounds-checking, not replay
   verification** — `resolve_run` checks duration/plausible-score ranges
   (`min_run_ms`, `max_plausible_score`), but does not replay or verify
   individual slice events. A sufficiently careful cheat that stays within
   plausible bounds would not be caught. See
   [claimlabs-anti-cheat](../.claude/skills/claimlabs-anti-cheat/SKILL.md).
4. No hardcoded secrets found in tracked files — `SUPABASE_SERVICE_KEY`,
   `ADMIN_KEY`, `FOODICS_WEBHOOK_SECRET` are all read from `process.env`
   (`lib/db.mjs`). Not independently verified against the actual Vercel
   environment-variable dashboard (no access).
5. No leftover debug/cheat hooks (`?dev` point-injection, etc.) found in
   `mcdonalds/engine/game.js` or `src/` — a prior lineage (`fastfood-ninja`)
   had one; this build appears clean, but re-verify before each release
   (see `claimlabs-code-review` skill).

## Missing tests

**No automated test suite exists anywhere in this build.** No `tests/`
directory, no Playwright/Jest/Vitest config, no `package.json` at all. Prior
verification (per the inherited `krispy-kreme` session log now folded into
`PROGRESS.md`) was done ad hoc via a throwaway, uncommitted diagnostic HTML
harness. This is the single biggest structural gap relative to the
`claimlabs-testing` skill's requirements.

## Missing documentation

Before this session: `DESIGN.md`, `README.md`, `PROGRESS.md`, and
`admin.html`'s `<title>` all still described the **Krispy Kreme** phase this
build was forked from, not the actual McDonald's build — corrected
2026-08-06 (see `docs/decisions/`). No architecture docs, no security docs,
no runbooks, no ADRs existed prior to this Claude Code system being created.

## Missing / blockers

- **No Git repository anywhere in scope.** The GitHub connector (branches,
  PRs, issues) has nothing to attach to until one is created. Recommend:
  `git init` inside `mcdonalds/` (not the parent `first project/` folder,
  which contains unrelated sibling builds), add a `.gitignore` for
  `.vercel.krispy-kreme-link.bak`, `node_modules`, etc., then decide on a
  remote (new private GitHub repo) — **do not proceed with `git init` or a
  remote push without explicit approval**, both are durable, hard-to-fully-
  reverse actions on shared history.
- **No `package.json` / lockfile** — there is currently no dependency
  management, so npm-based tooling (linters, Playwright, formatters) has
  nothing to install into yet. First implementation task should likely
  address this.
- Stale/leftover branding not yet fixed (tracked here, not blocking):
  🌶️ chili-pepper lives glyph (`engine/game.js`, variable `chilis`) and the
  Pasta & Heat rooster-"P" mascot on the welcome screen — both inherited
  from the original Slicy-P build, never re-themed for McDonald's.
