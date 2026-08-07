# Production-readiness audit — Ninja Slice / McSlice Rush

Audit date: **2026-08-07**. Auditor: Claude Code session.
Baseline commit: `00ddfed` (tag `baseline-2026-08-07`, branch
`backup/pre-production-2026-08-07`).

Every claim below was verified by reading the current code and/or driving the
game in a real browser at 390×844. Where a pre-existing doc in this repo says
otherwise, that is called out explicitly — several inherited docs are wrong.

---

## 1. Exact project location

```
C:\Users\user\Desktop\first project\mcdonalds\
```

Sibling builds in `C:\Users\user\Desktop\first project\` are older lineage:

| Folder | Brand / name | Verdict |
|---|---|---|
| **`mcdonalds/`** | McDonald's — "McSlice Rush" | **Source of truth** |
| `krispy-kreme/` | Krispy Kreme "Glaze Rush" | Parent fork, not current |
| `krispy-kreme.backup-20260725-172931/`, `…-184929/` | Krispy Kreme | Inactive snapshots |
| `fastfood-ninja/` | Nashville Pasta & Heat — "Pasta Ninja" / "Slicy-P" | Original engine ancestor |
| `slicy-p-deploy/`, `slicy-p-ui/` | Slicy-P | Superseded static exports |
| `pasta-react/` | Slicy-P | Dead-end React UI, no backend |
| `C:\Users\user\dough-or-die\` | "Dough or Die" (donut) | **Unrelated game**, ruled out |

Naming note: the brief calls the game **Ninja Slice**; the code, Stitch project
and all docs call it **McSlice Rush** (product line: **Slice Rush**). No
`Ninja Slice` string exists anywhere in the tree. Treated as the same product
under a new working title — see Open Questions.

## 2. Current source-of-truth version

`mcdonalds/` at baseline `00ddfed`. Confirmed by: newest mtimes (Aug 6),
correct McDonald's branding in `engine/config.js`, real McDonald's item sprites
in `assets/items/`, and the only build with the `src/` ES-module refactor.

**No Git history existed before this audit** — `git init` was run as part of
this pass purely to create a rollback point. No remote is configured.

## 3. Current stack and architecture

- **Frontend:** vanilla JS, **no bundler, no `package.json`, zero npm deps.**
  Two coexisting and *unreconciled* layers:
  - `engine/*.js` (1073 lines) — classic global-IIFE scripts. `config.js`,
    `platform.js`, `audio.js`, `game.js`. The real Canvas 2D game loop.
  - `src/*.js` (~1100 lines) — ES-module app shell: `core/{router,store}.js`,
    `pages/*.js` (7), `components/ui.js`, `adapters/engine-bridge.js`,
    `styles/*.css` (4).
  - `index.html` loads `engine/*` as `<script>` globals, then `src/main.js`
    as `type="module"`.
- **Backend:** Vercel Functions `api/*.mjs` (12), mirrored by hand in
  `netlify/functions/*.mjs`. Supabase Postgres via raw PostgREST `fetch`
  (`lib/db.mjs`, 94 lines). `supabase/schema.sql` (681 lines) holds tables +
  row-locked RPCs (`resolve_run`, `start_play`, `credit_order_points`).
  **This entire backend is currently orphaned — see §12, finding S1.**
- **PWA:** `manifest.webmanifest` + `sw.js` (cache-first).
- **Local dev:** `server.py` (Python stdlib, threaded).
- **Deploy:** `vercel.json` present; `.vercel/` link was detached (ADR 0002)
  and **not relinked** — this build cannot currently be deployed anywhere.
- **Retired:** `_legacy-ui-backup/` (10 files) — the pre-refactor UI. This is
  where the real backend client used to live.

## 4. Existing game flow (as actually implemented)

```
index.html
  → engine globals boot, canvas #game bound once for the session
  → src/main.js registers hash routes, Router.start()
  → #/            WelcomePage      (auto-guest profile; PLAY NOW)
  → #/sign-in     SignInPage       (name entry / continue as guest — no OTP)
  → #/play        PlayPage         guard: Store.isSignedIn()
                                   window.Game.init() + startGame()
                                   30s round, 2 lives, canvas engine
      ├─ score >= 15000 (client-side!) → #/win  VictoryPage
      └─ otherwise → in-place "Time's up!" modal → Play again / Rewards / Home
  → #/rewards     RewardsPage      localStorage point spend
  → #/leaderboard LeaderboardPage  local mock standings
  → #/assets      AssetLibraryPage item reference
```

**No network call is made at any point in this flow.**

## 5. Existing screen list (7 routes + overlays)

| Route | Page | State |
|---|---|---|
| `/` | `welcome.js` (60 ln) | Works; off-brand rooster mascot |
| `/sign-in` | `signin.js` (103 ln) | Name only, no phone/OTP |
| `/play` | `play.js` (171 ln) | Works but portrait-broken; doubled HUD |
| `/rewards` | `rewards.js` (109 ln) | Client-side point spend |
| `/leaderboard` | `leaderboard.js` (97 ln) | Local mock data |
| `/win` | `victory.js` (70 ln) | Reads the real recorded run |
| `/assets` | `assets.js` (42 ln) | Item library reference |

Overlays (not routes): pause modal, loss modal, toast.
**Absent entirely:** loading screen, how-to-play, reward-claim/code screen,
reward wallet, profile, terms/eligibility, error & offline states.

*Correction to inherited docs:* `.claude/rules/ui.md` and
`docs/project-inventory.md` both claim `victory.js` "reads a mock `Store`".
That is stale — `play.js:134` calls `Store.recordRun()` with the real engine
result and `victory.js:8` reads `lastRun`. The figures on the victory screen
are genuine.

## 6. Latest relevant Stitch project

**"McSlice Rewards Arcade"** — `projects/11798987857471355483`,
updated **2026-08-04**, device MOBILE, visibility PUBLIC, owner = user.
(The other project, "Krispy Kreme HOT NOW — Slice Game"
`projects/11742018577238953304`, updated 2026-07-29, is the older lineage.)

Design system extracted from it (`designMd`): **"Arcade Juicy"** — neo-brutalist
outlines + skeuomorphic bevels. Red `#DA291C`, gold `#FFC72C`, charcoal
`#27251F`, font **Sora**, 3–5pt charcoal strokes, hard-edged bevels with a 4px
bottom lip, block shadows, 16px radii, 20px safe-area inset, 4px spacing unit.
`src/styles/tokens.css` already encodes most of this correctly.

## 7. Stitch screens found

Named app screens (of ~80 instances; many hidden variants and raw images):

- **Welcome:** "Ronald Welcome"
- **Home:** "Home (Technical Spec)" *(has HTML export)*
- **Sign in:** "Ronald Sign In"; "Catch the Fries - Sign In" *(has HTML)*
- **Gameplay:** "Gameplay" ×2 *(one has HTML)*; "Active Gameplay" *(has HTML)*
- **Win:** "You Won!" ×2 *(one has HTML)*
- **Reward reveal:** "Spin to Win (Library Items)" *(HTML)*; "Spin to Win
  (Minimalist)" *(HTML)*
- **Leaderboard:** "Pro Leaderboard" **×7 variants** (one has HTML)
- **Rewards catalogue:** "Rewards Catalog"
- **Asset library:** "Asset Library" *(HTML)*; "McSlice Rush Item Assets" (SVG)
- **Operator:** "Campaign Control Dashboard Visual"
- **Marketing only (not app screens):** "McSlice Rush Premium Promo", "Slice
  Rush Premium Hero Visual", "Catch the Fries Promo Graphic", several
  AI-render prompt compositions, WhatsApp reference photos, avatar generations

Local extracted snapshot: `stitch-export/screens/` (7 screens with reference
PNGs; 4 with `source.html`).

**Stitch gaps — designs that do not exist and must be designed here:** loading,
how-to-play, pause, **loss screen**, reward wallet, reward code detail,
profile, terms/eligibility, error/offline/empty states.

**Stitch traps — attractive but harmful:**
- *7 near-identical "Pro Leaderboard" variants* — pure duplication; pick one.
- *"Spin to Win"* screens render the **compliance-flagged random wheel**
  (`docs/security/reward-wheel-compliance.md`). Do not implement as a wager.
- *"Catch the Fries"* screens are **out of scope** per `CLAUDE.md:7-9`.
- The gameplay mockups depict a **landscape**-ish stage with heavy chrome; the
  real constraint is portrait with a maximised play area.

## 8. Recommended final screen architecture (9 routes + 6 overlays)

| # | Screen | Purpose | Player action | Why a screen (not a modal) |
|---|---|---|---|---|
| 1 | **Loading** | Cover asset/sprite preload; brand first impression | none | Not a route — a shell state before the router paints, so it cannot be navigated to or back into |
| 2 | **Welcome / campaign entry** | What the game is, what you can win, how long a round is | Tap PLAY | Entry point of the scan-to-play QR journey; must be deep-linkable |
| 3 | **Verify (phone + OTP)** | Minimal identity for reward attribution | Enter phone → code | Needs its own URL so a refresh mid-OTP is recoverable |
| 4 | **Play** | The game | Slice | Owns the canvas and a rAF loop; must tear down on exit |
| 5 | **Result** | One screen for **both** win and loss | Claim / retry | Merged deliberately — see below |
| 6 | **Reward wallet** | All codes, redeemed state | Show cashier | Revisited independently of any round; deep-linked from receipts |
| 7 | **Leaderboard** | Social proof / replay driver | Browse | Independently linkable |
| 8 | **Rewards catalogue** | What is winnable, before playing | Browse | Answers "what can I win" pre-round; drives first play |
| 9 | **Terms & eligibility** | Legal | Read | Must be a stable, linkable URL for compliance |

**Overlays, not screens:** how-to-play (first-run coach card over the play
screen — teaching in context beats a screen users skip), pause, reward-code
detail sheet, error toast/banner, offline banner, confirm-claim sheet.

**Merge win + loss into one Result screen.** The player needs the same four
facts either way (score, best, what happens next, reward status). Two screens
duplicates layout and doubles the surface to keep consistent, and the current
split is already inconsistent — win is a full route, loss is a modal.
Differentiate by headline, colour and the primary action, not by route.

**Reject / drop:**
- 6 of 7 Stitch "Pro Leaderboard" variants.
- Standalone profile screen → fold into wallet header (one avatar + name + best
  score row); too little content to justify a route.
- Standalone reward-claim screen → sheet on Result; a separate route invites
  double-claim via back-navigation.
- `#/assets` item library as a *player* route → keep as a dev/QA-only route,
  or fold into the rewards catalogue. It currently sits in the player nav and
  reads as debug UI.
- "Catch the Fries" everything (out of scope).

**Screen count: 7 routes today → 9 routes.** The growth is entirely legal,
identity and reward-trust surface that a commercial build cannot skip; two
existing screens get merged and one gets demoted.

## 9. Screens to keep / combine / redesign / remove

| Action | Screens |
|---|---|
| **Keep, light polish** | Leaderboard (rebuild on the single best Stitch variant), Rewards catalogue |
| **Keep, redesign** | Welcome (replace rooster mascot; fill the dead centre band; state round length + prize up front), Play (portrait rebuild — see §10) |
| **Combine** | Win route + loss modal → one **Result** screen |
| **Add (no Stitch design exists)** | Loading, Verify+OTP, Reward wallet, Terms, How-to-play overlay, error/offline states |
| **Demote** | `#/assets` → dev-only |
| **Remove** | Duplicate leaderboard variants; "Catch the Fries" assets; eventually `_legacy-ui-backup/` (keep until the backend client is ported out of `data.js`) |

## 10. Gameplay problems

**G1 — CRITICAL: the engine is landscape-only, the shell is portrait.**
`CONFIG.WIDTH/HEIGHT = 1280×720` (landscape virtual resolution) drawn into a
390×844 portrait viewport. Verified in-browser: the canvas HUD renders
**rotated 90°** down the right edge while the play field is a near-empty band.
The brief mandates portrait-first. This is the single biggest gameplay defect
and blocks everything else. Fix: portrait virtual resolution (e.g. 720×1280)
with spawn geometry, gravity and HUD anchors derived from it.

**G2 — CRITICAL: doubled HUD with contradicting values.** The canvas draws
lives as `🌶️` (`engine/game.js:611-616`, variable `chilis`, inherited from
Pasta & Heat) while the DOM overlay draws `❤` (`src/pages/play.js:80`). Both
render simultaneously. Verified visually.

**G3 — Difficulty curve never completes.** `RAMP_TIME = 50` >
`ROUND_TIME = 30` (`engine/config.js:37,75`), so the spawn interval / bomb
chance ramp only ever reaches ~60% of its range. The round's final seconds are
supposed to be the tense part; they currently plateau mid-curve.

**G4 — Win condition contradicts the spec.** Brief and `CLAUDE.md`: win =
survive 30s. Code: `endGame()` treats timer-expiry and 0-lives identically
(`engine/game.js:703-717`), and "won" is `score >= 15000`
(`src/adapters/engine-bridge.js:14,50`). A player who dies to 2 bombs at 28s
with 16k score currently *wins*. Needs both a real survival flag and a product
decision on whether score gates the reward at all.

**G5 — Stale hardcoded HUD seeds.** `play.js:22-23` initialises the HUD to
`'60'` seconds and `'❤❤❤'` (3 lives) — the pre-ADR-0001 values, hardcoded
instead of read from `CONFIG.ROUND_TIME` / `CONFIG.START_LIVES`. Visible for
the first 100ms of every round, and a direct violation of the repo's own
"config is the only tuning surface" rule.

**G6 — Legacy input events, not Pointer Events.** `mousedown`/`mousemove` +
`touchstart`/`touchmove` registered separately (`engine/game.js:325-336`), with
`mousemove`/`mouseup` bound to `window`. No `setPointerCapture`, no
`touch-action` guarantee, no coalesced-event handling. On mobile this risks
dropped/duplicated slices and scroll interference.

**G7 — Hitbox shrunk, tunnelling possible.** `segmentHitsFood` uses
`dist < f.r * 0.85` (`engine/game.js:295`) — a 15% smaller hitbox than the
sprite, which reads as unresponsive. Segment-vs-circle handles within-frame
tunnelling, but only one segment per frame is tested from `lastSlicePos`, so a
fast flick across a 50Hz frame can still miss.

**G8 — No unavoidable-bomb guard.** `spawn.hardCount` up to 4 items with
`bombChanceHard 0.16` and no positional constraint — nothing prevents a wave
that is geometrically impossible to clear without hitting a bomb. The brief
explicitly forbids this.

**G9 — Pause/visibility gaps.** `visibilitychange` pauses (`play.js:125`) but
there is no `blur`/`pagehide` handling, no resume countdown (round resumes
instantly, mid-air items already falling), and `restart()` does not reset
`ended` state on the engine side. Frame delta is clamped to 50ms — correct,
keep it.

**G10 — No deterministic/seeded mode**, so no gameplay scenario is reproducible
in a test.

## 11. UI problems

**U1 — Off-brand mascot.** The welcome screen shows the **Pasta & Heat
rooster-"P"** (`assets/mascot.png`). Verified visually. Fatal for a McDonald's
pitch.
**U2 — Dead space.** ~45% of the welcome viewport is empty flat red between
logo and mascot at 390×844.
**U3 — Canvas HUD competes with DOM HUD** (see G2) — the brief's "UI elements
must not compete with the play area", violated twice over.
**U4 — Two style systems.** `src/styles/tokens.css` (current, Stitch-derived)
vs `_legacy-ui-backup/style.legacy.css` + `stitch-home.css`. Only the first
ships, but the second is still on disk and in the fork's muscle memory.
**U5 — No design-system primitives for** modal variants, empty states, error
states, offline banner, reward card, code chip, timer urgency.
**U6 — i18n regressed.** `_legacy-ui-backup/i18n.js` had EN+AR with RTL; the
`src/` layer has **no i18n at all**. Arabic support was lost in the refactor.
**U7 — Accessibility gaps.** Lives conveyed by glyph colour/shape only; the
canvas is not described to assistive tech; icon buttons have labels (good) but
the score/time pills are not `aria-live`.
**U8 — Emoji as product art.** `WHEEL.prizes` and `SPECIALS` use OS emoji
(`🎟️🍟🥔`), which render differently per platform — not premium.

## 12. Security problems

**S1 — CRITICAL: rewards are decided entirely client-side. The whole backend
is orphaned.**
`src/adapters/engine-bridge.js:47-59` overwrites `window.LoyaltyData` with a
local implementation whose own comment reads *"there is no authoritative
backend wired up for the McDonald's prototype."* `submitRun()` returns
`won: score >= WIN_SCORE` computed **in the browser**. Verified by grep: the
only `fetch` in `src/` is a local function named `fetchStandings()`; **nothing
in `src/` or `engine/` calls `/api/*`.** The real backend client survives only
in retired `_legacy-ui-backup/data.js`.

Consequences: a player can set `Store` state or call
`LoyaltyData.submitRun(1e9)` from the console to "win"; `Store.recordRun()`
mints `score/10` reward points into localStorage (`store.js:119`);
`Store.redeem()` spends them locally (`store.js:138-150`). No session token, no
nonce, no replay protection, no idempotency, no budget, no audit log — because
no server is involved at all.

**This directly contradicts `CLAUDE.md:23-26` ("non-negotiable"),
`REVIEW.md:26`, and `docs/project-inventory.md:104-107`, which asserts
server-authoritative resolution as a "working feature (verified, not just
read)". That prior verification checked that the backend files exist; it did
not check that the client calls them. Corrected here.**

**S2 — OPEN (unchanged): reward-wheel compliance.** Weighted random draw
(28% → 0.2%) for real-value prizes; this repo's own `DESIGN.md` §6 calls that
sweepstakes/gambling risk. See `docs/security/reward-wheel-compliance.md`.
**Needs a legal/business decision — not an engineering fix.** Blocks any
launch with real prize value.

**S3 — Score validation is bounds-checking, not verification.** `resolve_run`
checks `min_run_ms` / `max_plausible_score` only. No event replay. A cheat that
stays inside plausible bounds passes. (Moot until S1 is fixed, then live.)

**S4 — No identity.** Sign-in takes a name; anyone is "Guest Slicer". Nothing
prevents multi-account reward farming. Phone+OTP exists in the retired legacy
layer and in the `api/register.mjs` endpoint, but is not in the current flow.

**S5 — No rate limiting, no emergency campaign shutdown, no audit log** in the
shipped path.

**S6 — RLS unverified.** `lib/db.mjs` uses the service-role key server-side and
*assumes* Supabase RLS blocks everything else. Never independently confirmed.

**S7 — Deploy-target risk (mitigated, not closed).** `.vercel/` pointed at
Krispy Kreme's live project (ADR 0002); detached but **not relinked**, so the
next `vercel` command in this folder will prompt to create/link and can repeat
the mistake.

**Clean:** no hardcoded secrets (all `process.env`); `secretEquals` uses
constant-time comparison; no `?dev` point-injection cheat in `engine/game.js`
or `src/` (the `fastfood-ninja` `O`-key cheat was not carried over). The
`Store.grantPoints()` test helper (`store.js:159`) is client-only and becomes
harmless once S1 is fixed — but must not survive into a server-backed build.

## 13. Performance problems

**P1 — No build step at all.** No bundler, no minification, no tree-shaking, no
cache-busting hashes. ~20 separate JS/CSS requests on cold load.
**P2 — Unoptimised assets.** `assets/` is ~4.4 MB of PNG/JPG (`desktop.jpg`,
`gameplay-ref.jpg`, mockup JPGs) shipped as static files. No WebP/AVIF, no
responsive sizes, no lazy loading. Several are *mockup references* that should
never reach production.
**P3 — Blocking font CSS.** `index.html:14-16` loads Google Fonts (Anton +
Sora, 4 weights) via a render-blocking `<link>` with no `font-display` control
beyond `&display=swap` and no self-hosting/subsetting.
**P4 — 100ms polling for HUD.** `play.js:73` polls `canvas.dataset` — string
reads/writes through the DOM every frame on the engine side
(`game.js:571`) plus a 10Hz interval. Should be an event/shared-object push.
**P5 — Service worker is cache-first over everything** (`sw.js`), which will
serve stale JS after a deploy since nothing is content-hashed.
**P6 — No measurement.** No Lighthouse baseline, no FPS counter, no input-
latency instrumentation, no mid-range-device pass. Frame budget unknown.
**P7 — Particles/popups arrays are unbounded** per round (`game.js` `particles`,
`popups`, `halves`) with no pooling or hard cap.

## 14. Testing gaps

**Zero automated tests exist.** No `tests/`, no `package.json`, no Playwright/
Vitest config, no CI. All prior verification was ad-hoc via a throwaway HTML
harness. Nothing persists between sessions.

Missing, in the brief's terms: unit, spawn-system, collision, timer,
win-condition, two-bomb-loss, API integration, reward idempotency, budget
race-condition, browser, mobile-viewport, full win-flow, full loss-flow,
network-failure, replay, visual-regression, production-build verification.

Also missing as prerequisites: any lint config, any formatter, any type
checking (the whole codebase is untyped vanilla JS — `.claude/rules/
typescript.md` confirms zero `.ts` files), and any deterministic seeded-RNG
mode to make gameplay reproducible.

## 15. Prioritised implementation plan

Ordered by (a) does it block a commercial launch, (b) does it block other work.

### Stage 0 — Safety net ✅ DONE
`git init`, `.gitignore` hardened, baseline commit `00ddfed`, tag
`baseline-2026-08-07`, branch `backup/pre-production-2026-08-07`. No remote.

### Stage 1 — Toolchain floor (unblocks every later stage)
`package.json`; Prettier + ESLint; `jsconfig.json` with `checkJs` for type
checking without a rewrite; Vitest for unit tests; Playwright for browser
tests; npm scripts (`lint`, `format`, `typecheck`, `test`, `test:e2e`, `build`).
No framework, no bundler yet — keep the no-build runtime working.

### Stage 2 — Portrait gameplay rebuild (G1, G2, G5)
Portrait virtual resolution; delete the canvas HUD entirely and let the DOM own
it (removes the doubling *and* the 🌶️ at once); HUD seeded from `CONFIG`;
spawn geometry re-derived for a tall play field. **This must land before any UI
polish** — every screenshot of the play screen is invalid until it does.

### Stage 3 — Game rules correctness (G3, G4, G8)
Distinct `survived` outcome flag; `RAMP_TIME` rebalanced to the 30s round;
spawn-wave validator that guarantees every wave is clearable. Record the
win-condition product decision as an ADR.

### Stage 4 — Server-authoritative rewards (S1, S3, S4, S5)
Port the real backend client out of `_legacy-ui-backup/data.js` into
`src/services/`; wire `start-run` → `submit-run`; signed short-lived session +
nonce + one-time submission; server-minted codes; idempotent issuance; atomic
budget; rate limits; audit log; phone+OTP verify screen. **Largest single
stage.** Blocked on nothing, but see S2 for the wheel.

### Stage 5 — Screen architecture + design system (§8, U1–U8)
Merge win/loss → Result; add Loading, Verify, Wallet, Terms, how-to-play
overlay, error/offline states; component primitives; replace the rooster;
restore EN/AR i18n; accessibility pass.

### Stage 6 — Game feel (brief's "game-feel improvements")
Slice trails, impact, combo escalation, controlled particles with pooling,
audio cues, countdown urgency, reduced-motion respect.

### Stage 7 — Campaign/brand manifest
Schema-validated per-restaurant config with safe defaults; move brand content
out of `engine/config.js` into a validated manifest; prove reskin by config.

### Stage 8 — Performance (P1–P7)
Asset optimisation and mockup purge; self-hosted subset fonts; drop the HUD
poll; content-hashed build + SW strategy fix; Lighthouse + FPS baseline on a
throttled mid-range profile.

### Stage 9 — Analytics
The brief's 19-event taxonomy, with no PII or reward-sensitive values in
payloads.

### Stage 10 — Full test suite + docs + release
Everything in §14; ADRs; refresh `CLAUDE.md`, `README.md`, `PROGRESS.md`,
`docs/project-inventory.md`; deploy runbook and a correct Vercel link.

## 16. Acceptance criteria

**Gameplay**
- Portrait play at 320×568, 360×800, 375×667, 390×844, 412×915: play field
  fills the stage, exactly one HUD, no rotated canvas text, no clipping.
- A full 30s round is completable; the timer reaches 0 and produces a result.
- Exactly 2 bomb hits ends the round as a **loss**; 1 hit does not.
- Surviving 30s produces a **win** distinguishable in state from a bomb-out.
- Difficulty ramp completes within 30s; no wave is unclearable.
- Slice registers on a fast flick across the sprite's visible bounds.
- Pause/resume and tab-hide/restore lose no state and never drain the timer.
- ≥50 fps sustained on a 4× CPU-throttled profile.

**Rewards / security**
- No win, prize, code or point balance originates in the browser.
- Console tampering with score/Store/LoyaltyData cannot yield a reward.
- Replaying a captured submit-run request yields exactly one issuance.
- Concurrent duplicate claims yield exactly one code (budget never oversold).
- No cheat keys, no debug endpoints, no secrets in client code.
- An adversarial pass covering the brief's 11 attack classes finds no new high.

**UX**
- First-time player can state game, prize, controls, loss rule and round length
  from the pre-play screens alone.
- Campaign entry → reward in hand: no dead ends, no repeated instructions.
- Result screen states score, best, reward status and next action in one view.
- Every reward shows value, code, expiry, conditions, redemption steps and
  redeemed state.
- All seven brief-listed reward failure states render a real, recoverable UI.
- No fake reward is ever shown without a successful server issuance.

**Quality gates**
- `npm run lint`, `format:check`, `typecheck`, `test`, `test:e2e`, `build` all
  pass.
- Unit coverage on spawn, collision, timer, win/loss, and reward idempotency.
- Docs match implementation; ADRs recorded for each material decision.
- Final diff contains no unrelated changes and no sibling-build edits.

## Open questions (need a human decision — not silently invented)

1. **Name.** Is the product now **Ninja Slice**, or is "Ninja Slice" a working
   title for **McSlice Rush**? A rename touches `BRAND.gameName`, `<title>`,
   manifest, icons, docs and the Stitch project name.
2. **S2 reward-wheel compliance.** Random weighted wheel (current) vs
   deterministic/player-chosen (this repo's own design doc). **Blocks launch.**
3. **Win condition.** If winning = surviving 30s, does score still gate the
   reward, or does survival alone earn it? The two rules currently conflict and
   the brief endorses survival.
4. **Order-points threshold.** `WHEEL.pointsThreshold = 4000` (config) vs
   `WIN_SCORE = 15000` (client) vs the `settings` table — three different
   sources of truth for eligibility.
5. **Deploy target.** Which Vercel project should `mcdonalds/` link to? None
   currently. Requires explicit approval per `CLAUDE.md`.
6. **Client reality.** Is McDonald's an actual signed client, or is this a
   pitch build? It changes how far the legal surface (S2, terms, OTP consent)
   must be built out before launch.
