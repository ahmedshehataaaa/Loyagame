# ClaimLabs — Slice Rush (McDonald's build)

## What ClaimLabs is

ClaimLabs is a B2B game studio building custom-branded HTML5 skill games for
restaurant/QSR brands. One reusable game engine, reskinned per restaurant
through configuration — not forked per client. **Current scope: Slice
Rush only.** Do not build or reference "Catch the Fries" unless explicitly
instructed.

## Slice Rush — current scope

- 30-second round. **Win: survive the full round. Loss: hit 2 bombs.** Real,
  not aspirational (ADR 0004): `resolveOutcome()` derives it from round state,
  and `api/submit-run.mjs` re-derives survival from duration server-side before
  any prize is drawn. Score is leaderboard bragging rights and does not gate
  the win.
- Restaurant-specific content lives in a **validated campaign manifest**
  (`campaigns/<id>.json`, ADR 0012), loaded with `?campaign=<id>`.
  `engine/config.js` is the tuning + fallback surface, not the reskin surface.
  `campaigns/example-reskin.json` proves a second restaurant is a JSON file.
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
├── src/           # ES-module app shell
│   ├── game/      #   PURE, tested mechanics (ballistics, waves, collision, rules, fx)
│   ├── services/  #   the ONLY code that talks to the reward backend
│   ├── campaign/  #   manifest schema + loader
│   ├── analytics/ #   closed event taxonomy + allow-listed redactor
│   ├── core/      #   router, store, i18n, live rule reads
│   └── pages/     #   one function per screen
├── api/           # Vercel Functions (start-run, submit-run, pos-credit, admin-*)
├── netlify/functions/  # mirror of api/ for Netlify hosting
├── lib/db.mjs      # Supabase/PostgREST helper, admin auth, phone normalization
├── supabase/schema.sql  # tables + atomic RPCs (resolve_run, start_play, credit_order_points...)
├── assets/         # McDonald's sprites — some still stale-branded, see known issues
├── campaigns/     # per-restaurant manifests, schema-validated in CI
├── scripts/       # build, campaign validation, perf baseline
├── tests/         # unit (Vitest) + e2e (Playwright, 6 viewports)
├── stitch-export/  # Stitch design references ("McSlice Rewards Arcade")
├── _legacy-ui-backup/  # retired, not shipped
└── docs/, .claude/  # this system
```

A local Git repository exists (created 2026-08-07; baseline tag
`baseline-2026-08-07`, branch `backup/pre-production-2026-08-07`). **No remote
is configured** — pushing anywhere is still a human decision.

## Technology stack

- **Frontend:** vanilla JS, no framework. Canvas 2D gameplay engine
  (`engine/game.js`) + ES-module app shell (`src/`). Development needs **no
  build step**; `npm run build` produces a hashed, minified `dist/` for
  deployment only (ADR 0013).
- **Backend:** Vercel Serverless Functions (`.mjs`), Supabase Postgres via
  PostgREST (raw `fetch`, no ORM).
- **Local dev server:** `server.py` (Python stdlib, threaded as of ADR
  0003).
- **Deploy:** Vercel (primary), Netlify (secondary/mirror routes).

## Essential commands

```bash
npm install
npm run dev              # http://localhost:8765 — serves the SOURCE, no build
npm run verify           # format + lint + typecheck + manifests + unit tests
npm test                 # Vitest — the pure modules
npm run test:e2e         # Playwright — 732 tests, 6 mobile viewports
npm run build            # hashed, minified dist/  (deployment only)
npm run preview          # serve dist/ on :8767
npm run perf             # measured load + fps baseline at 4x CPU throttle
npm run validate:campaigns
```

`?play` bypasses the mobile/tablet device gate on desktop. It grants no points,
rewards or eligibility, and must never be extended to.
`?campaign=<id>` loads a manifest from `campaigns/`.

CI (`.github/workflows/verify.yml`) runs `npm run verify`, the production build
with a bundle-size guard, and the full browser suite.

Two harness facts worth knowing before writing tests:

- Headless Chromium here throttles `requestAnimationFrame` to roughly 1.3fps, so
  a spec must never wait on wall-clock round progress. Round length and win/loss
  rules are covered deterministically in `tests/unit/`.
- The reward e2e specs stub the backend with `page.route`. There is no reachable
  Supabase instance, so server-side guarantees are **not** covered by tests —
  see ADR 0009 "Outstanding".

## Architecture boundaries

- **`engine/` vs `src/`:** `engine/*.js` are the real game loop, loaded as
  plain `<script>` globals that share top-level scope (`game.js` reads
  `SPECIALS` out of `config.js`'s scope — never bundle them as ES modules).
  `src/*.js` is the ES-module layer, wired in via
  `src/adapters/engine-bridge.js`. The engine reaches tested logic through
  `window.Mechanics`, published before it is ever ticked (ADR 0005).
  The two are now reconciled: **the DOM owns all in-round UI** (the canvas HUD
  was deleted, ADR 0006) and the result screen reads the real round.
- **Anything laid over the canvas must be pointer-transparent** (ADR 0015). An
  overlay once won the hit test across the whole play field and the game could
  not be sliced at all — and every test missed it, because they dispatched
  events straight at the canvas.
- **Reward decisions are server-only.** `resolve_run`, `start_play`,
  `credit_order_points` in `supabase/schema.sql` are the authority. Client
  code (`engine/game.js`, `src/`) may only _display_ what the server
  returns, never compute a win/prize itself.
  As of ADR 0009 this is actually wired (it was not before — the backend was
  orphaned and the browser decided wins). **`src/services/loyalty.js` is the
  only code that may call the reward API**, and `src/services/reward-state.js`
  is the only code that may decide whether a prize is displayable. Do not add a
  second API caller, and do not let a screen construct a prize — the invariant
  lives in one pure function precisely so it can be proved exhaustively in
  tests. Order points are written only by `loyalty.js`, only from a real
  response: a round result travelling through the engine's UI bridge is
  page-scriptable and must never be trusted with a balance.
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
- Comments explain _why_, not _what_ — match the existing style in
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
