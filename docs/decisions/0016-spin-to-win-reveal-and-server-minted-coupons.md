# 0016 — Spin to Win is a reveal, and the coupon is minted with the win

Date: 2026-08-12
Status: Accepted

## Context

Two things arrived together, and they are only safe together.

**The reveal.** The Result screen told a winner what they had won in a line of
text. The Stitch reference for this campaign (`04_spin_to_win_screen.png`) is a
prize wheel, and a wheel is what the brand expects: the moment a player earns is
worth staging. ADR 0010 had merged win and loss into one Result screen precisely
because two layouts for the same four facts had drifted apart — so the wheel had
to be added **without** reintroducing a second result layout.

**The coupon.** A prize the player cannot present at a counter is not a prize.
`resolve_run` recorded the win in `wheel_wins` but issued no code, so the reward
was real in the database and unusable in the shop.

The dangerous version of both is the obvious one: let the wheel spin, see where
it lands, then ask the server to honour that and hand back a code. That puts a
real-money decision in the browser — the exact class of bug ADR 0009 closed, in
new clothes.

## Decision

### The order is fixed, and the code enforces it

1. `LoyaltyData.submitRun()` → `resolve_run` performs the weighted draw and
   **mints the coupon in the same row-locked transaction**.
2. Only then is the overlay built. `spinWheel({ mintCoupon })` is handed a
   thunk that resolves to the already-recorded `RewardOutcome`.
3. The wheel animates to whatever that outcome names, and stops there.

The spin is a **reveal**, not the randomness source. There is no path in
`src/components/spin-wheel.js` that could make it one: it never picks an index
except by looking one up (`segments.findIndex(s => s.key === outcome.prize.key)`),
and it never spins at all until `mintCoupon()` has resolved.

The segment ORDER also comes from the server (`wheel` on the submit-run
response, carried through `reward-state.js`), so the animation and the award
cannot disagree about which slice is which. The client's configured prize list
is a layout fallback only, used before any response exists.

### A survivor always sees the wheel; only a prize makes it turn

Reaching the wheel is gated on **survival**, not on eligibility. An ineligible
survivor opens it, presses SPIN, and is told why nothing was won — with their
`orderPoints / pointsThreshold` — while the disc stays still. A wheel that turns
and lands on nothing reads as a loss the player caused, when in fact they simply
had too few order points.

An **eliminated** round skips the overlay entirely and goes straight to Result.

Error, flagged and pending outcomes never turn the disc either: `showError()`
offers a retry and a close, `showDenial()` explains, and neither can render a
prize, because only `showPrize()` can, and only from `outcome.prize`.

### Codes are minted in Postgres, and are bearer tokens

`mint_coupon_code()` (`supabase/schema.sql`) generates `MC-XXXX-XXXX` from a
32-character alphabet with `I`, `O`, `0` and `1` removed — codes get read aloud
at a counter, and a support ticket for a mistyped code is a real cost.
`wheel_wins.code` carries a unique partial index: two players must never hold
the same code. The old 9-argument `resolve_run` overload is dropped, so a
database that has not been migrated fails loudly rather than silently issuing
prizes with no code.

The code is displayed and copyable, and it goes nowhere else. It is **not**
written to the store, and `REWARD_ISSUED` analytics carry the prize KEY only —
a bearer token in an event stream is a leak with a long tail.

### Overlay, not route

The wheel is an element appended to the play screen, so `#/play` stays the
route and Result stays the one merged screen ADR 0010 established. Both exits
(`close`, `View My Rewards`) remove the overlay and navigate — however the
reveal ends, the player is never stranded on it.

Per ADR 0015 the overlay is over the canvas, so it takes pointer events
deliberately: the round is finished by the time it exists, and it covers the
field.

### `data-act` addresses the actions

Each action button carries `data-act="spin|close|retry|wallet"`. The accessible
name stays the visible, translated text; `data-act` is how a test or a
screenshot script names the action independently of language, so the same
selector drives the reveal in English and Arabic.

## Consequences

- **Every spec that finishes a round as a survivor now passes through the
  reveal.** `UI.showChooser()` emits `won: true`, so twenty existing browser
  tests that expected an immediate route change sat on `#/play` until they timed
  out. They are fixed by traversal (`tests/e2e/spin-reveal.js`), not by
  weakening an assertion — and one of them, `an absurd score does not produce a
prize`, was strengthened: it had been asserting an empty Result screen while
  the overlay was still up, which passes vacuously.
- **`supabase/schema.sql` must be applied by hand before any deploy** — new
  column, new index, new function, dropped overload. Additive and idempotent,
  matching that file's convention.
- **The open compliance flag gets sharper, not softer.**
  `docs/security/reward-wheel-compliance.md` asks for legal sign-off on random
  weighted odds for real-value prizes. The odds have not changed, but the UI is
  now literally a prize wheel, and the player now walks away holding a code.
  ADR 0008 recorded a product decision; that is still not the sign-off this
  needs. Re-raise it before launch.
- The reveal costs the winner ~4.2s. Reduced motion skips the animation and
  announces the result immediately, per `.claude/rules/ui.md`.

## Verification

**Unit** — `tests/unit/spin-wheel.test.js`: `rotationForIndex()` brings the
named index under the pointer for every segment count in play, and
`wheelSegments()` prefers the server's order over the client's config.

**Browser** — `tests/e2e/spin-wheel.spec.js`, across the six-viewport matrix:

1. A survived round opens the wheel; a lost round never does.
2. `submit-run` is called strictly **before** the animation starts.
3. The wheel lands on the segment the server chose — asserted with `off25`, a
   **0.2%-weight** prize a client-side random would essentially never select.
4. The code shown is the server's string, verbatim; copy puts it on the
   clipboard, and falls back to selecting it when the clipboard is blocked.
5. An ineligible survivor is told why and the disc never turns.
6. A flagged run does not pay out through the wheel, and its prize label appears
   nowhere in the DOM.
7. Network failure offers a retry; a 500 shows an error state, not a prize.
8. Every ending reaches `#/result`.
9. The outcome is announced in an `aria-live` region — the wheel itself is
   `aria-hidden` decoration, so without it a screen-reader user gets nothing.
10. Reduced motion reveals the prize without a spin.

The reward-authority and reward-adversarial suites continue to prove the
invariant end to end through the new flow: the wheel is one more surface that
could leak a fabricated prize, and the hostile-body cases now assert
`.spin__prize` is empty on the wheel as well as on the Result screen.

## Outstanding

Unchanged from ADR 0009 and still the biggest risk: no integration test against
a real database. Code uniqueness, one-time token consumption and row locking are
verified by reading `supabase/schema.sql`, not by running it — there is no
reachable Supabase instance here. `mint_coupon_code()`'s retry loop and the
unique index are exactly the kind of guarantee a mocked database would hide.
