# 🍔🔪 McSlice Rush

A **Fruit-Ninja-style arcade slicing game** built as a scan-to-play McDonald's
loyalty program. Players slice flying McDonald's menu items to score points,
chain combos, and — once their real ORDER-POINTS balance clears a threshold —
spin a prize wheel for real menu rewards.

> Client build for McDonald's. Reskinned from the shared Slicy-P engine
> (originally built for Nashville Pasta & Heat, also reskinned as Krispy
> Kreme "Glaze Rush"). Do not copy Slicy-P/Krispy Kreme content back into
> this build without checking `engine/config.js` — brand content, rules and
> the reward model have all diverged since the fork.

## ▶️ How to run

**Easiest:** double-click `index.html` — runs straight in the browser, no
build step, no server, works offline. Play in **landscape**.

**Or serve it** locally:

```bash
python3 server.py     # then open http://localhost:8765
```

> **Testing on desktop:** add `?play` to the URL to bypass the mobile gate.
> Chrome DevTools' device toolbar (`Cmd/Ctrl+Shift+M`) is the best way to
> preview it.

## 📱 Mobile & tablet only

Built for touchscreens. Desktop shows a "play on your phone" gate (with a
live QR code). Always runs in **landscape** — portrait auto-rotates.

## 🎮 How to play

- **Swipe / drag** to slice menu items → earn score.
- Slice multiple items in one swipe for **combos** (score multiplier).
- **Avoid 🔥 Burnt Fries** — slicing one costs a life. **2 lives** — round
  ends after the 2nd hit.
- Each round is a **30-second timer** — surviving it also ends the round.

## 🎁 Reward model (current — "play-to-win" wheel, July 2026 pivot)

- **Loyalty (order) points come only from real purchases** — credited
  server-side via POS/Foodics webhook, never from gameplay.
- **No discount-code tiers.** Reaching the round's score/points threshold
  (`WHEEL.pointsThreshold` in `engine/config.js`, currently 4000 order-points)
  unlocks a **prize wheel** at game-over — a real weighted spin server-decided
  in `resolve_run` (`supabase/schema.sql`), the client only animates it.
- Below the threshold, the player gets a "try again" nudge instead.
- Winning locks the player out of the wheel for `LIMITS.winLockoutHrs` (12h);
  round-play itself is currently **unlimited** (`LIMITS.maxPlays`).

## 🗂️ Project structure

```
mcdonalds/
├── index.html          # loads engine/*.js as globals, then src/main.js as an ES module
├── engine/              # core game loop: config.js, platform.js, audio.js, game.js
├── src/                 # newer app shell: core/{router,store}.js, pages/*.js,
│                        #   adapters/engine-bridge.js, styles/*.css (McSlice Rush tokens)
├── api/                 # Vercel functions: start-run, submit-run, pos-credit, admin-*...
├── netlify/functions/    # mirror of api/ for Netlify hosting
├── lib/db.mjs            # shared Supabase/PostgREST helper (service-role key, admin auth)
├── supabase/schema.sql   # players, points_ledger, runs, wheel_wins, settings + RPCs
├── assets/               # McDonald's item sprites, mascot, brand-logo
├── stitch-export/        # Stitch design references ("McSlice Rewards Arcade")
└── _legacy-ui-backup/    # retired pre-refactor UI, kept for reference, not shipped
```

## 🔌 Backend (already wired, not just planned)

Unlike the original Slicy-P prototype, this build's backend is real, not
`localStorage` mocks:

| Endpoint | Does |
|---|---|
| `POST /api/start-run` | Grants a round; issues a one-time server token |
| `POST /api/submit-run` | Resolves the round server-side (`resolve_run` RPC, row-locked, plausibility-checked) |
| `POST /api/pos-credit` | POS/Foodics webhook credits order-points (secret-verified) |
| `admin-*` | Dashboard data for `admin.html` |

Recommended stack (already in use): **Vercel Functions** + **Supabase
Postgres** (PostgREST) + **Foodics webhook** for POS integration.

**Known gaps** (see the audit for the full list): `RAMP_TIME` (difficulty
ramp, 50s) is longer than the round (30s) after the round-time change — the
difficulty curve never reaches its "hard" end within a round. No automated
test suite exists yet.
