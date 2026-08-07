# 0008 — Reward reveal stays a weighted-random wheel (pending legal sign-off)

Date: 2026-08-07
Status: Accepted — **with an open, unresolved compliance dependency**

## Context

`docs/security/reward-wheel-compliance.md` records a standing conflict. This
project's own inherited `DESIGN.md` §6 says:

> Do **not** implement "spend order-points on a random wheel for real-value
> prizes" — that risks sweepstakes/gambling classification. The reward is
> **deterministic / player-chosen**.

What ships is the opposite: `CONFIG.WHEEL.prizes` carries weighted odds (28%
down to 0.2% for a free Big Mac®) and `resolve_run` performs a weighted random
draw server-side. A prior session had already replaced this with a
deterministic player-chosen chooser; a "July 2026 pivot" reverted it.

During the 2026-08-07 production-readiness pass this was surfaced to the project
owner as one of three blocking product decisions, alongside a recommendation to
adopt the deterministic chooser and an option to build both behind a flag.

## Decision

**Keep the weighted-random wheel.** Chosen by the project owner on 2026-08-07
after the compliance concern was presented explicitly.

Recorded consequences of that choice, which are **not** resolved by it:

1. The compliance flag in `docs/security/reward-wheel-compliance.md` **stays
   open**. This ADR records a product decision about mechanics; it is not a legal
   opinion and does not constitute the sign-off that file asks for.
2. **Written sign-off from whoever owns legal/compliance risk for ClaimLabs is
   still required before any launch involving real prize value** at the current
   thresholds and weights. When obtained, append it to the compliance doc with
   the name and date of the person who gave it, and update this ADR's status.
3. Reviewers touching `WHEEL` or `resolve_run` must still read the compliance
   doc first. Nothing here pre-approves changes to prize odds or value.

## Consequences

- The reward model is unchanged by this pass; no wheel or `resolve_run` code was
  modified on 2026-08-07.
- `DISCOUNT_TIERS` was deleted from `engine/config.js` in the same pass. It was
  dead code from the pre-pivot score-tier model, and this decision confirms it is
  two models out of date. Recoverable from tag `baseline-2026-08-07`.
- The deterministic-chooser code from the earlier session may still exist dead in
  the tree. It is not being revived, but it should not be deleted while the
  compliance question is open — it is the implementation path if the answer comes
  back "no wheel".
- ADR 0004 (survival wins) is independent of this: survival decides the *round*,
  order-points decide *wheel eligibility*, and the wheel decides *which prize*.

## Verification

None applicable — no code changed. The decision is recorded here and
cross-referenced from `docs/security/reward-wheel-compliance.md`.
