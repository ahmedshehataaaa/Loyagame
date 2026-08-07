# OPEN: Reward wheel compliance conflict

**Status: STILL UNRESOLVED. Needs a legal/business decision, not an engineering
fix. Do not silently change this — see `[[feedback-flag-dont-fix]]` pattern
in agent memory.**

> **Update 2026-08-07.** The project owner was presented with this conflict and
> chose to **keep the weighted-random wheel** — recorded in
> `docs/decisions/0008-keep-weighted-random-wheel.md`. That is a _product_
> decision about mechanics. It is **not** the legal sign-off this file asks for,
> and it does not close this issue.
>
> Still outstanding: **written sign-off from whoever owns legal/compliance risk
> for ClaimLabs**, before any launch involving real prize value at the current
> `WHEEL.pointsThreshold` and per-prize weights. When that exists, append it
> below with the name and date of the person who gave it, and only then change
> this status.

## The conflict

This project's own inherited `DESIGN.md` (written during the Krispy Kreme
"Glaze Rush" phase, §6) states:

> Do **not** implement "spend order-points on a random wheel for real-value
> prizes" — that risks sweepstakes/gambling classification. The reward is
> **deterministic / player-chosen**. A spinning selector may be used **only
> as presentation after the reward is already assigned/chosen** — never as a
> wager.

What actually ships in `mcdonalds/` today:

- `engine/config.js`'s `WHEEL.prizes` array assigns **weighted random odds**
  to each prize (28% down to 0.2% for the rarest, real-value prize like a
  free Big Mac®).
- `supabase/schema.sql`'s `resolve_run` RPC performs the actual **weighted
  random draw server-side** — the client only animates whatever the server
  already decided.

## Why this isn't a fresh mistake

Per the inherited `krispy-kreme/PROGRESS.md` session log (now preserved in
this build's `PROGRESS.md` under "Prior history"): a previous session
**already built and verified** a deterministic, player-chosen reward flow
(`UI.showChooser()` → player taps a real product → server records the
choice) specifically to fix this exact compliance concern. A later "July
2026 pivot" (see the comment block at the top of `WHEEL` in
`engine/config.js`) reverted back to the random-weighted wheel. The
deterministic-chooser code may still exist, dead, in the codebase — verify
before assuming it needs to be rebuilt from scratch.

## What to do

1. **Do not treat the current wheel as pre-approved.** Anyone extending the
   reward system should read this file first.
2. This needs an actual legal/compliance answer from ClaimLabs before any
   launch involving real prize value at the current point thresholds
   (`WHEEL.pointsThreshold`, currently 4000 order-points, per-prize weights
   in `engine/config.js`).
3. If the decision is "revert to deterministic chooser": check whether the
   old `showWheel`/`spinWheel`/`#screen-wheel` code (and its `showChooser`
   counterpart) still exists before rebuilding either.
4. If the decision is "keep the random wheel": get that in writing from
   whoever owns legal/compliance risk for ClaimLabs, and update this file to
   record the decision and who made it (ADR-style, see `docs/decisions/`).

## Who should catch this going forward

The `security-adversary` and `backend-reward-engineer` agents
(`.claude/agents/`) both check this file as part of their standard review
of any change touching `WHEEL`, `resolve_run`, or reward issuance. The
`claimlabs-reward-security` skill links here.
