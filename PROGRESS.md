# PROGRESS.md — McSlice Rush (McDonald's)

## Current checkpoint — 2026-08-12 (viewport, leaderboard UI, standings data)

Decision record: **ADR 0017**. Branch `fix/viewport-leaderboard-ui`.

**The desktop overflow was a render-box bug, not a scaling one.**
`Platform.viewport()` returned `window.innerWidth/innerHeight`, but the canvas
lives inside `#app` — a phone-shaped column with `overflow: hidden`. On a
1920px display the engine sized a 1920px canvas into a 480px shell and the rest
was clipped, so the player saw a cropped, off-centre slice. It measures the
shell now, a `ResizeObserver` keeps the two in step, and above 700×700 the
shell is a real centred 390:844 phone frame. Mobile is untouched — no viewport
below the breakpoint changes at all.

Three things this broke, all caught by the suite and all real:

- `field-bounds.spec.js` computed its expected visible range from
  `window.innerWidth` — the **same wrong assumption** as the bug being fixed,
  so it disagreed with the engine the moment the engine got it right.
- The desktop assertion in that spec ("the TOP is the cropped axis at
  1366×768") described geometry that can no longer occur. It now covers the
  phone frame, and the apex clamp it used to prove moved to a landscape phone,
  where the render box genuinely is wider than the field.
- A `ResizeObserver`'s **initial** callback fires before the module layer
  publishes `window.Mechanics`, so the built bundle died on boot with
  "Mechanics is not defined". Dev never showed it; `production-build.spec.js`
  did.

**The "null" on the standings screen was `Node.append(null)`.** `el()` filters
null children; the raw `listHost.append(a, b, cond ? node : null)` does not — it
stringifies. The ternary was falsy in the ordinary case *and* the guest case, so
the board printed a literal "null" under the last row essentially always. Row
shaping moved to a pure `src/game/standings.js` with the null/NaN guards proved
directly (27 unit tests).

Leaderboard rebuilt against `stitch-export/screens/leaderboard/source.html`:
bevelled season card with the turning sunburst, per-row cards, podium icons,
tier copy, PTS unit, rotated YOU flag. Emoji replaced with real SVG in the new
`src/components/icons.js` — medals, tab bar, empty/error states. Seeded rivals
are seven real first names.

Audit: `tests/e2e/viewport-audit.spec.js`, own Playwright project, 16 checks
across 1440/1920/768/390/393.

## Previous checkpoint — 2026-08-12 (Spin to Win + server-minted coupons)

Decision record: **ADR 0016**. The reward reveal now runs through a prize
wheel, and a win now comes with a coupon code the player can actually present
at a counter.

**The repo is now published** (2026-08-12): `origin` is
`github.com/ahmedshehataaaa/Loyagame`, `main` tracks `origin/main`. Everything
below this line was local-only until that push. Collaborators need `npm
install` and, for the backend only, the env vars listed in README.md — none of
which are in the tree.

### The rule that holds the whole thing up

**The server mints the coupon and picks the prize BEFORE the wheel is built.**
`spinWheel()` is handed a thunk resolving to an already-recorded
`RewardOutcome`, looks up which segment that names, and stops there. The spin is
a reveal, never the randomness source — the inverse (spin, then ask the server
to honour where it landed) would put a real-money decision back in the browser,
which is the class of bug ADR 0009 closed.

`mint_coupon_code()` generates `MC-XXXX-XXXX` inside `resolve_run`'s row-locked
transaction, from an alphabet with `I`/`O`/`0`/`1` removed so a code read aloud
at a counter cannot be mistyped. `wheel_wins.code` has a unique partial index.

### What else landed

- **Spawns stay inside the visible field** (`src/game/field.js`). COVER scaling
  makes the virtual field wider than a tall viewport, and the fixed spawn
  margins knew nothing about the crop: 32–40px of every edge-most item was off
  screen on **four of the six supported viewports**. Now a pure, tested
  geometry module derives the visible slice on every resize.
- `src/core/rules.js` guards `window` itself, not just `CONFIG`, so the rules
  modules can be imported by Node unit tests instead of throwing.
- `el()` applies CSS custom properties. `Object.assign(node.style, …)` silently
  drops every `--custom` key, which is why the wheel's segments settled at the
  wrong angle.
- Wheel action buttons carry `data-act` (`spin`/`close`/`retry`/`wallet`) so
  tests address the action, not the translated label.

### The 20 tests this broke, and why they were right to break

`UI.showChooser()` emits `won: true`, so every legacy spec that finished a round
as a survivor got the overlay instead of an immediate route change and sat on
`#/play` until it timed out. Fixed by **traversing** the reveal
(`tests/e2e/spin-reveal.js`), not by weakening an assertion. One case was
strengthened: `an absurd score does not produce a prize` had been asserting an
empty Result screen while the overlay was still up — passing vacuously. The
hostile-body cases now also assert the wheel itself renders no prize, since the
reveal is a second surface that could leak one.

### Verification

**183 unit + 732 browser tests**, all passing across 320/360/375/390/412/430.
Format, lint, typecheck clean. `dist/` rebuilt (1120.2 KB, 51 files) and the
production-build specs re-run against it.

### Still required before any deploy — both human actions

1. **Apply `supabase/schema.sql` by hand.** This checkpoint adds
   `wheel_wins.code`, its unique index and `mint_coupon_code()`, on top of the
   survival gate. Additive and idempotent; a stale database fails loudly.
2. **Link a Vercel project this build owns** (ADR 0002, still open).

### And one thing that got sharper, not smaller

`docs/security/reward-wheel-compliance.md` is still open. The odds have not
changed, but the UI is now literally a spinning prize wheel and the player walks
away holding a code. ADR 0008 recorded a product decision; that is still not the
legal sign-off this asks for. Re-raise it before launch.

_(`docs/decisions/0012-*.md` is referenced by CLAUDE.md but does not exist —
worth reconstructing.)_

---

## Previous checkpoint — 2026-08-11 (all 10 audit stages complete)

Audit: `docs/audit/2026-08-07-production-readiness-audit.md`. Every decision:
`docs/decisions/` (ADRs 0004–0015).

### The single most important finding, found last

**The game could not be sliced at all.** `.game-screen` won the pointer hit test
across the entire play field, so input never reached the canvas — 0 slices in 48
real mouse swipes. Every test missed it because they dispatched `MouseEvent`s
directly at the canvas, which bypasses hit-testing: they proved the slicing
maths and proved none of it was reachable. Fixed in ADR 0015, along with a move
to Pointer Events with capture. Measured after: 250 points in 2 swipes.

The generalisable lesson, now written into `.claude/rules/tests.md`: **a
synthetic event aimed at the element you hope handles it cannot tell you whether
a player could reach it.**

### Stage summary

| Stage | What                                                   | ADR        |
| ----- | ------------------------------------------------------ | ---------- |
| 0     | Git baseline + backup branch                           | —          |
| 1     | Toolchain from zero (lint, types, unit, e2e)           | —          |
| 2     | Portrait-native play field; canvas HUD deleted         | 0006       |
| 3     | Survival wins; fair waves; completing ramp             | 0004, 0007 |
| 4     | Server-authoritative rewards (fixes S1)                | 0009       |
| 5     | One Result screen; wallet/terms/coach; Arabic restored | 0010       |
| 6     | Effect budgets; branded blade; reduced motion          | 0011       |
| 7     | Restaurants become validated data                      | 0012       |
| 8     | 1.19 MB purged; PWA fixed; production build            | 0013       |
| 9     | Closed, redacting analytics taxonomy                   | 0014       |
| 10    | Docs, CI, security review, release runbook             | —          |

### Verification

**157 unit + 654 browser tests** across 320/360/375/390/412/430, all passing.
Lint, typecheck, format, campaign-manifest validation clean. CI runs all of it.

Measured at 4× CPU throttle: **first contentful paint 376 ms**, 13 requests,
469 KB transferred, **frame delta median 16.7 ms (~59.9 fps), p95 16.8 ms**.

### Security review (2026-08-11)

- No hardcoded secrets anywhere in shipped code; all four read from
  `process.env` and compared with `timingSafeEqual`.
- No client-side reward decision. `loyalty.js` is the only API caller;
  `reward-state.js` the only code that may decide a prize is displayable.
- No cheat key or point-injection path. `ffn_dev` bypasses only the _device
  gate_ and grants nothing.
- All 12 `api/*.mjs` byte-identical to their `netlify/functions/` mirrors apart
  from the db import path.
- `dist/` ships no `_legacy-ui-backup/`, no `stitch-export/`, no `.env`.

### ⚠️ Required before any deploy — both human actions

1. **Apply `supabase/schema.sql` by hand.** `resolve_run` gained a survival gate
   and the old 8-arg overload is dropped, so a stale database fails loudly.
2. **Link a Vercel project this build owns.** `.vercel/` was detached from
   Krispy Kreme's live project (ADR 0002) and never relinked.

### Still open, and why

- **No integration test against a real database.** Row locking, one-time token
  consumption and campaign budget are verified by code reading only — no
  Supabase instance is reachable here. Biggest remaining risk.
- **Reward-wheel compliance is UNRESOLVED.** ADR 0008 records the decision to
  keep the weighted random draw; that is a product decision, not the written
  legal sign-off `docs/security/reward-wheel-compliance.md` asks for.
- **Identity is unverified** — no OTP, by explicit product decision. Multi-account
  farming stays open.
- No rate limiting or emergency campaign shutdown in the client-facing path.
- Redemption is counter-only until the catalogue is wired to `redeem_wheel_win`.
- No analytics vendor (events buffer behind `setSink()`); no Lighthouse run
  (depends on hosting headers); images still PNG/JPEG; RLS assumed not verified.

---

## Previous checkpoint — 2026-08-07 (Stage 4: server-authoritative rewards)

**Audit finding S1 is fixed.** The client now talks to the reward backend that
had been orphaned; nothing about a reward is decided in the browser. Full
rationale and the exhaustive list of what is still open: **ADR 0009**.

### What changed

- **`src/services/`** — `api.js` (transport, typed error taxonomy, errors
  returned not thrown), `reward-state.js` (**pure**: the invariant that a prize
  requires an explicit server award), `loyalty.js` (round sessions, identity, the
  only code that calls the API).
- **`src/components/reward-panel.js`** — the only component that may show a
  prize, and it can only show `outcome.prize`. No product-naming fallback copy.
- **Round sessions**: `/play` calls `start-run` on mount and on every restart
  (each round needs its own token); `submit-run` presents it; a `consumed` flag
  set synchronously before the await means one round submits exactly once.
- **Survival gates the reward, server-side**: `api/submit-run.mjs` re-derives
  survival from round duration and ignores the client's claim. `resolve_run`
  gains `p_survived` and gates the prize draw inside the locked transaction; the
  old 8-arg overload is dropped so a stale DB fails closed.
- **Client-side value creation closed**: `recordRun()` no longer mints
  `floor(score/10)` spendable points; `redeem()` fails closed with
  `server_required`; `grantPoints()` deleted; order points are mirrored only by
  `loyalty.js`, only from a real response.
- **`signin.js` actually registers** (was a `setTimeout` pretending to). Button
  says "Continue", not "Send Code" — nothing is sent and **nothing is verified**.
  Guest sign-in clears any stored identity, so guest rounds are practice rounds.
- Rounds are labelled **before** play as prize or practice (`.game-stake`).

### Verified

- **69 unit tests** (+20), **252 browser tests across 6 viewports, 3 consecutive
  clean runs.** Lint, typecheck, format clean.
- The reward suites stub the backend at the network boundary, so real pages,
  engine, service layer and store are exercised: denial, 500, aborted request,
  malformed body, `won`-with-no-prize, flagged run → **no prize rendered**;
  explicit award → exactly the server's prize.
- Adversarial suite: max-int scores, forged result objects, 8 concurrent
  submissions, stale tokens, prototype pollution, cheat-key sweep. **It caught a
  real defect** — a forged balance persisting via the UI bridge — now fixed.

### ⚠️ Required before any deploy

**`supabase/schema.sql` must be applied by hand.** The new `resolve_run`
signature and the `round_time_sec` / `survival_tolerance` settings rows are
required for `submit-run` to work at all. Per
`.claude/rules/database-migrations.md` this is a human action.

### Still open on the reward path (see ADR 0009 "Outstanding")

No integration test against a real Supabase instance — no credentials exist
here, so row locking, one-time token consumption and campaign budget remain
verified by code reading only. RLS unverified. No rate limiting, emergency
campaign shutdown, or audit-log surface. **No real OTP** (unverified identity is
a standing product decision; real verification needs an SMS provider).

---

## Previous checkpoint — 2026-08-07 (production-readiness pass, stages 0-3)

Full audit: `docs/audit/2026-08-07-production-readiness-audit.md`.
**Git now exists** (it did not before): baseline `00ddfed`, tag
`baseline-2026-08-07`, branch `backup/pre-production-2026-08-07`. Local only,
no remote.

### Done this session

- **Toolchain from zero**: `package.json`, ESLint 9, Prettier, `tsc --checkJs`
  (+ `types/globals.d.ts`), Vitest, Playwright. `npm run verify` runs the lot.
- **Portrait-native play field** (ADR 0006). Was 1280×720 landscape rotated 90°
  in CSS; now 720×1280 upright, cover-scaled. The sideways canvas HUD and the
  🌶️ chilli lives glyph are **gone** — the canvas HUD is deleted outright and
  the DOM owns in-round UI alone. Doubled-HUD issue resolved.
- **Win condition fixed** (ADR 0004): surviving the round wins; score is
  leaderboard only. Previously `score >= 15000` decided it _in the browser_, so
  bombing out at 28s with a high score showed the victory screen.
- **Wave fairness + ramp** (ADR 0007): hazards are provably dodgeable (max 1 per
  wave, ≥0.18 field-width corridor clearance); `RAMP_TIME 50` → `RAMP_FRACTION
0.85` so difficulty actually completes inside the 30s round.
- **Testable mechanics** (ADR 0005): `src/game/{rng,ballistics,collision,
wave-planner,round-rules}.js`, pure and seeded, reached via `window.Mechanics`.
- **49 unit + 72 Playwright tests** (6 viewports). Lint, typecheck, format clean.
- Hitbox `0.85` → `HIT_TOLERANCE 1.08`; HUD seeded from `CONFIG`; `DISCOUNT_TIERS`
  deleted; rotate-hint path removed.
- **Reward wheel kept** per owner decision (ADR 0008). The compliance flag in
  `docs/security/reward-wheel-compliance.md` remains **OPEN** — a product
  decision is not the legal sign-off that file requires.

### Corrections to earlier docs

- **S1, the biggest open finding**: the shipped client is **fully
  client-authoritative**. `src/adapters/engine-bridge.js` overwrites
  `window.LoyaltyData` with a local stub; nothing in `src/` or `engine/` calls
  `/api/*`. The Vercel/Supabase backend is **orphaned** — its client was retired
  with `_legacy-ui-backup/data.js`. The 2026-08-06 entry below (and
  `docs/project-inventory.md`) list server-authoritative resolution as a verified
  working feature; that check confirmed the backend files exist, not that the
  client calls them. **Still true, still unfixed — Stage 4.**
- `victory.js` reading "a mock Store" is stale: it reads the real recorded run.

### Next (priority order)

1. **Stage 4 — server-authoritative rewards (S1).** Port the backend client out
   of `_legacy-ui-backup/data.js`; `start-run` → `submit-run`; signed
   short-lived session + nonce + one-time submit; server-minted codes; idempotent
   issuance; atomic budget; rate limits; audit log; real phone+OTP.
2. Stage 5 — screen architecture (merge win/loss → Result; add Loading, Verify,
   Wallet, Terms, how-to-play overlay, error/offline) + replace the **off-brand
   Pasta & Heat rooster mascot** + restore EN/AR i18n.
3. Stage 6 game feel · 7 brand manifest · 8 performance · 9 analytics · 10 docs
   and release.

### Known environment gotcha

Headless Chromium in this harness throttles `requestAnimationFrame` to ~1.3fps,
so e2e specs must not assert on wall-clock round progress. Round-length and
win/loss rules are covered deterministically in `tests/unit/` instead.

---

## Previous checkpoint — 2026-08-06 (ClaimLabs audit + first fixes)

This file previously held a Krispy Kreme "Glaze Rush" session log — copied
into this folder when the McDonald's build was forked from Krispy Kreme, and
never updated. That log is preserved below under **Prior history** since it's
still accurate about the shared engine's evolution; just not about _this_
folder specifically.

### Where things actually stand

- **Two layers coexist:** the classic `engine/*.js` (config, platform, audio,
  game — real gameplay loop, canvas engine) loaded as globals, plus a newer
  `src/` ES-module app shell (router, store, pages) wired in via
  `src/adapters/engine-bridge.js`. The `src/` layer is mid-refactor — e.g.
  `src/pages/victory.js` currently reads from its own local `Store`, not from
  the actual `engine.js` round result, so the two aren't fully reconciled.
- **Backend is real**, not mocked: Vercel Functions (`api/*.mjs`, mirrored in
  `netlify/functions/`) talk to Supabase Postgres via PostgREST
  (`lib/db.mjs`). `start-run` → `submit-run` uses one-time server tokens;
  `resolve_run` (`supabase/schema.sql`) is row-locked and does the actual
  win/prize decision server-side.
- **Reward model:** a weighted-random prize wheel gated on a real
  order-points threshold (`WHEEL.pointsThreshold`, currently 4000). **This
  conflicts with this project's own design doc**, which flags random wheels
  for real prizes as sweepstakes/gambling risk and calls for a
  deterministic/player-chosen reward instead — see `DESIGN.md` §6. Not fixed
  this session; needs a legal/business decision.
- **Round rules** — just changed this session to match the Slice Rush spec:
  `ROUND_TIME` 60→30s, `START_LIVES` 3→2 (`engine/config.js`). Verified
  against `engine/game.js`: `lives--` on a bomb hit, `endGame()` at
  `lives <= 0`, so "loses after 2 bombs" is now correctly wired.
  ⚠️ **Not yet adjusted:** `RAMP_TIME` is still 50s — longer than the new
  30s round, so the spawn/bomb-chance difficulty curve never reaches its
  "hard" end within a round. Needs a rebalance pass.
- **Vercel:** `mcdonalds/.vercel` was pointing at the same live Vercel
  project as `krispy-kreme/` (`prj_y9kuQXsAAfFLWqqa9dzO6sp6NWu5`, confirmed
  via the Vercel API to have a real production deployment and public
  domains). Detached this session — renamed to
  `.vercel.krispy-kreme-link.bak` — so a deploy from this folder won't
  silently overwrite Krispy Kreme's production site. **A fresh `vercel
link` (new or existing McDonald's-specific project) is needed before this
  build can be deployed.**
- **Known stale-branding bug:** the in-round HUD still renders lives as
  🌶️ (chili pepper) glyphs — a leftover from the original Pasta & Heat
  build (`engine/game.js`, variable literally named `chilis`). Not fixed
  this session (docs-only pass); needs a real asset/glyph swap.
- **No automated tests exist.** All prior verification (per the log below)
  was done ad-hoc via a throwaway, uncommitted diagnostic HTML harness.

### Next-session TODO (priority order)

1. Resolve the reward-wheel compliance question (`DESIGN.md` §6) — legal/
   business call, not an engineering one.
2. Rebalance `RAMP_TIME` (and spawn/bomb-chance curve) now that `ROUND_TIME`
   is 30s, not 60s.
3. Swap the 🌶️ lives glyph for something on-brand for McDonald's.
4. Reconcile `src/pages/*` with the real `engine.js` round results (currently
   diverging — see `victory.js`).
5. Link `mcdonalds/` to its own Vercel project before any deploy.
6. Stand up an actual automated test suite (Playwright, per the
   ClaimLabs QA requirements) — nothing currently persists across sessions.

---

## Prior history (Krispy Kreme "Glaze Rush" phase — kept for context)

Checkpoint written because the user was closing that chat. Everything below
was already saved to disk at the time (not just in conversation), for the
`krispy-kreme/` folder specifically — this build was later forked from that
state and reskinned for McDonald's.

### Where things stood then (verified working, headless-tested, zero console errors)

1. **DESIGN.md** committed — the locked art direction ("HOT NOW Neon
   Kitchen"), color/type tokens, two-currency rule, compliance-safe reward
   flow, game-feel spec, mobile-shell rules, security must-haves, build
   order.
2. **P0 mobile fullscreen fix** — `100dvh`, `env(safe-area-inset-*)`,
   scrollbar chrome hidden globally. No page scroll on phone sizes.
3. **Game-feel pass 1** (`js/game.js`) — escalating combo names, hero sparkle
   burst + emphasized name/score popup.
4. **Design tokens** added to `:root` in `css/style.css`.
5. **Home screen redesign** — hero sign → order-points number + progress bar
   → dominant PLAY button → compact support row.
6. **Results card redesign** — game score, new-best badge, leaderboard rank,
   separate order-points line (two-currency separation per DESIGN.md §5).
7. **Leaderboard prestige redesign** — grand-prize card, countdown, podium,
   pinned "you" row.
8. **Reward chooser — compliance fix (DESIGN.md §6):** replaced the random
   prize-wheel spin with a **deterministic reward menu**. `endGame()` →
   `UI.showChooser()` → player taps a real product → `LoyaltyData.claimReward
(key)` → `UI.showReward(prize)`. The old wheel/spin code was left in place
   (dead on the win path) in case the spin animation was wanted purely as
   post-choice presentation.

   _(This is the fix that was later reverted when the McDonald's build
   pivoted back to a random-weighted wheel — see the current checkpoint
   above.)_

### Known small gaps at that time

- `chooseReward` i18n string missing (EN/AR).
- `resolve_run` still did weighted-draw-and-record server-side even though
  the client had moved to player choice — flagged as needing simplification.
- Doughnut artwork was still primitive Canvas-drawn, not illustrated sprites.
- Server-validated anti-cheat for the leaderboard score was still open.
- Point-ownership/redemption security (OTP-at-redemption) was still open.
- No persistent automated QA — verification was ad-hoc headless Chrome +
  a temporary, uncommitted diagnostic harness.
