# McSlice Rush

A scan-to-play, mobile-first arcade slicing game wired into a restaurant's
rewards programme. Slice flying menu items for 30 seconds without hitting two
burnt batches; survive, and the server decides whether you have earned a prize.

Built by **ClaimLabs** as one reusable engine reskinned per restaurant through
configuration — not a fork per client. This repository is the **McDonald's**
campaign build.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:8765 — serves the source, no build step
```

Open it on a phone, or on a desktop browser at a mobile viewport. The game is
portrait-only by design.

```bash
npm run verify       # format + lint + typecheck + manifests + unit tests
npm run test:e2e     # 732 browser tests across 6 mobile viewports
npm run build        # hashed, minified dist/
npm run preview      # serve dist/ on :8767
npm run perf         # measured load + frame-rate baseline (4x CPU throttle)
```

## How it works

**One 30-second round. Two burnt batches ends it. Surviving the full round
wins.** Score is leaderboard bragging rights and does not gate the win
(ADR 0004).

Winning makes you _eligible_. An actual prize also needs order points, earned
only by ordering — never by playing — and is drawn and issued **by the server**.
The client displays what came back and nothing else (ADR 0009).

## Architecture

```
engine/          Canvas 2D game loop — classic scripts sharing top-level scope
src/
  game/          PURE, tested gameplay maths (ballistics, waves, collision, rules)
  services/      The ONLY code that talks to the reward backend
  campaign/      Manifest schema + loader — restaurants are data
  analytics/     Closed event taxonomy with an allow-listed redactor
  core/          router, store, i18n, live rule reads
  pages/         One function per screen
  components/    Shared render helpers
api/             Vercel Functions   (mirrored byte-for-byte in netlify/functions/)
lib/db.mjs       Supabase via raw PostgREST — no ORM, no npm deps
supabase/        Tables + row-locked RPCs (resolve_run, start_play, ...)
campaigns/       Per-restaurant manifests, schema-validated in CI
```

Two JS dialects coexist deliberately: `engine/*.js` are classic scripts
(`game.js` reads `SPECIALS` straight out of `config.js`'s scope), `src/` is real
ES modules. The engine reaches tested logic through `window.Mechanics`, published
before it is ever ticked (ADR 0005).

## Reskinning for another restaurant

Add `campaigns/<id>.json` and load it with `?campaign=<id>`:

```json
{
  "schemaVersion": 1,
  "brand": { "id": "demo-diner", "name": "Demo Diner", "gameName": "Diner Dash Slice", ... },
  "rules": { "roundSeconds": 45, "lives": 3 },
  "items": [ ... ],
  "hazard": { ... },
  "rewards": { "pointsThreshold": 1500, "prizes": [ ... ] }
}
```

`campaigns/example-reskin.json` is a working second campaign proving the path —
different brand, rules, items, prizes and feature flags, same engine.

The validator **fails loudly on anything touching money or fairness** (prize
weights and labels, thresholds, round rules) and **falls back quietly on
cosmetics** (a bad hex colour warns and defaults). An invalid manifest is
rejected wholesale, because a half-applied campaign could pair one restaurant's
prizes with another's threshold.

## Deploying

⚠️ **Two things must happen first, both by a human.**

1. **Apply `supabase/schema.sql` by hand** to the target Supabase project. The
   `resolve_run` signature gained a survival gate (ADR 0009) and the old
   8-argument overload is dropped, so a stale database fails loudly rather than
   silently resolving runs without the gate.
2. **Link a Vercel project this build actually owns.** `.vercel/` was detached
   from Krispy Kreme's live project (ADR 0002) and never relinked — a deploy
   from here previously would have overwritten a different client's site.

Then `npm run build` and publish `dist/`.

Environment variables (server-side only, never in client code):
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_KEY`, `FOODICS_WEBHOOK_SECRET`.

## Known limitations

Kept here rather than in a drawer, because every one of them is a real gap:

- **No integration test against a real database.** Row locking, one-time token
  consumption and campaign budget are verified by code reading only — no
  Supabase instance is reachable from this environment. Biggest remaining risk.
- **The reward wheel's compliance question is OPEN.** Weighted random draws for
  real prize value need written legal sign-off before launch. ADR 0008 records
  the decision to keep the wheel; that is a product decision, not the sign-off.
  See `docs/security/reward-wheel-compliance.md`.
- **Identity is unverified.** No OTP — `api/register.mjs` trusts the number as
  typed, by an explicit product decision. Multi-account farming stays open.
- **No rate limiting or emergency campaign shutdown** in the client-facing path.
- **Redemption is counter-only.** The catalogue refuses to grant value in-app
  until it is wired to `redeem_wheel_win`.
- **No analytics vendor.** Events buffer behind a `setSink()` seam.
- **Images are PNG/JPEG.** WebP/AVIF would cut the remaining ~345 KB.
- **RLS is assumed, not verified.**

## Documentation

|                            |                                                       |
| -------------------------- | ----------------------------------------------------- |
| `docs/audit/`              | The 2026-08-07 production-readiness audit             |
| `docs/decisions/`          | ADRs — every material decision, with what it replaced |
| `docs/product/`            | Product brief                                         |
| `docs/security/`           | Open compliance flags                                 |
| `docs/analytics-events.md` | The event taxonomy                                    |
| `docs/runbooks/`           | Local dev, pre-deploy checklist                       |
| `CLAUDE.md`                | Orientation for an agent session                      |
