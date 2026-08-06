# ClaimLabs — Slice Rush (McDonald's build)

## What ClaimLabs is

ClaimLabs is a B2B game studio building custom-branded HTML5 skill games for
restaurant/QSR brands. One reusable game engine, reskinned per restaurant
through configuration — not forked per client. **Current scope: Slice
Rush only.** Do not build or reference "Catch the Fries" unless explicitly
instructed.

## Slice Rush — current scope

- 30-second round. Win: survive the full round. Loss: hit 2 bombs.
  *(Caveat, verified in code: "survive to win" is not yet a distinct game
  state — see `docs/project-inventory.md` → "Incomplete features."
  Currently, win/loss for reward purposes is decided by score vs. the wheel
  points threshold, not survival. Don't assume the brief and the shipped
  code agree; check both.)*
- Restaurant-specific branding: colors, menu items, hazards, copy, assets,
  reward rules — driven by `engine/config.js`'s `CONFIG`/`BRAND`/`FOODS`/
  `BOMB` constants per build. This is the reskin surface; see
  `claimlabs-configurable-reskins`.
- Real discount codes / prizes are issued **only** by the server
  (`resolve_run` RPC), never the client. This is non-negotiable — see
  Security below.

## Repository map

**This repo root (`mcdonalds/`) is the McDonald's Slice Rush build — the
confirmed source of truth.** Full discovery record:
`docs/project-inventory.md`. Sibling folders one level up
(`../krispy-kreme/`, `../fastfood-ninja/`, `../slicy-p-*`, `../pasta-react/`)
are **other clients' builds or dead lineage** — do not edit them from here,
and do not copy their code back into this build without checking
`engine/config.js` first (brand content and the reward model have diverged
significantly since the fork).

```
mcdonalds/
├── engine/        # classic global-script game loop (config, platform, audio, game)
├── src/           # newer ES-module app shell (router, store, pages, components, styles)
│                  #   NOT YET reconciled with engine/ — see known issue below
├── api/           # Vercel Functions (start-run, submit-run, pos-credit, admin-*)
├── netlify/functions/  # mirror of api/ for Netlify hosting
├── lib/db.mjs      # Supabase/PostgREST helper, admin auth, phone normalization
├── supabase/schema.sql  # tables + atomic RPCs (resolve_run, start_play, credit_order_points...)
├── assets/         # McDonald's sprites — some still stale-branded, see known issues
├── stitch-export/  # Stitch design references ("McSlice Rewards Arcade")
├── _legacy-ui-backup/  # retired, not shipped
└── docs/, .claude/  # this system
```

No Git repository exists yet anywhere in this project tree. Do not assume
`git log`/branches/PRs are available until one is created — see
"Operations that require human approval."

## Technology stack

- **Frontend:** vanilla JS, no bundler, no `package.json`. Canvas 2D
  gameplay engine (`engine/game.js`) + ES-module app shell (`src/`).
- **Backend:** Vercel Serverless Functions (`.mjs`), Supabase Postgres via
  PostgREST (raw `fetch`, no ORM).
- **Local dev server:** `server.py` (Python stdlib, threaded as of ADR
  0003).
- **Deploy:** Vercel (primary), Netlify (secondary/mirror routes).

## Essential commands

```bash
# Local dev (from mcdonalds/)
python3 server.py                 # http://localhost:8765
# Testing on desktop browser (bypasses mobile gate + Saturday-style gates
# inherited from the loyalty model, plus dev helpers):
#   ?play   — bypass mobile/tablet gate
#   ?dev    — enable dev helpers
#   ?anyday — bypass any day-of-week gating inherited from prior builds
```
There is currently **no** `npm install`, `npm test`, `npm run build`, or
lint/typecheck command — no `package.json` exists. Setting this up (or
deciding not to, given the no-bundler constraint) is a reasonable first
implementation task; see `claimlabs-testing`.

## Architecture boundaries

- **`engine/` vs `src/`:** `engine/*.js` are the real game loop (loaded as
  plain `<script>` globals). `src/*.js` is a newer ES-module layer
  (router/pages/store) wired in via `src/adapters/engine-bridge.js`. They
  are **not fully reconciled** — `src/pages/victory.js` reads from its own
  mock `Store`, not the real `engine.js` round result, and the in-round HUD
  currently renders twice (once from each layer). Don't build new features
  assuming these are unified; check which layer actually owns a given
  screen first.
- **Reward decisions are server-only.** `resolve_run`, `start_play`,
  `credit_order_points` in `supabase/schema.sql` are the authority. Client
  code (`engine/game.js`, `src/`) may only *display* what the server
  returns, never compute a win/prize itself.
- **One engine, per-client config.** Brand/menu/hazard content lives in
  `engine/config.js`'s exported constants. Do not fork gameplay logic per
  restaurant — see `claimlabs-configurable-reskins`.

## Security non-negotiables

1. Reward issuance, win validation, and point crediting happen **only**
   server-side, inside row-locked Postgres RPCs. Never trust a
   client-submitted "I won."
2. `SUPABASE_SERVICE_KEY`, `ADMIN_KEY`, `FOODICS_WEBHOOK_SECRET` stay in
   `process.env`, never in committed files. Admin/POS auth uses
   constant-time comparison (`lib/db.mjs`'s `secretEquals`) — keep it that
   way if touched.
3. **The reward wheel has an open, unresolved compliance flag** — random
   weighted odds for real-value prizes, which this project's own inherited
   design doc calls sweepstakes/gambling risk. Read
   `docs/security/reward-wheel-compliance.md` before touching `WHEEL` or
   `resolve_run`. Do not resolve this by code change alone; it needs a
   legal/business decision.
4. No debug/cheat keys, exposed secrets, or test-only bypasses ship to
   production. A prior lineage (`fastfood-ninja`) had a demo point-cheat key
   — verify this build stays clean of that pattern before every release.
5. Vercel project links must point at a project this build actually owns —
   see ADR 0002; verify before every deploy, not just once.

## Coding conventions

- No framework, no bundler in `engine/` or `src/` — keep it that way unless
  a deliberate decision (documented as an ADR) changes it.
- `engine/config.js` is the single tuning/content surface — don't hardcode
  round time, lives, spawn rates, or brand colors elsewhere.
- Comments explain *why*, not *what* — match the existing style in
  `engine/config.js` and `lib/db.mjs` (both already do this well).
- Keep `engine/` (classic scripts) and `src/` (ES modules) each internally
  consistent with their own existing patterns; don't introduce a third
  style.

## Definition of done

A change is done when: acceptance criteria are met, targeted checks pass
(see `.claude/hooks/`), relevant tests pass (once a suite exists — see
`claimlabs-testing`), an adversarial security review has run for anything
touching rewards/sessions/campaigns (`security-adversary` agent), the game
was actually driven in a browser for gameplay/UI changes (not just read),
docs were updated for anything architectural, and no cheat keys, exposed
secrets, or debug leftovers remain. "I read the code and it looks right" is
never sufficient — see the mandatory self-correction workflow in each
skill.

## Operations that require human approval

- `git init` / creating or pushing to a remote repository (none exists yet).
- Any Vercel/Netlify deploy, especially production promotion.
- Creating a new Vercel project or changing project linkage.
- Any change to `resolve_run`, `WHEEL`, or reward-eligibility logic that
  affects real prize value, pending the compliance decision above.
- Writing to a production database, or running a production migration.
- Adding or rotating secrets/credentials.
- Force-push, destructive `git reset`, deleting directories, disabling
  security checks, or removing tests to make a build pass.

## Links

- Full audit: `docs/project-inventory.md`
- Open compliance issue: `docs/security/reward-wheel-compliance.md`
- Decisions log: `docs/decisions/`
- Review checklist: `REVIEW.md`
- Skills (detailed workflows): `.claude/skills/`
- Agents: `.claude/agents/`
