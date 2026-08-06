---
name: claimlabs-feature-planning
description: Use to convert a Slice Rush feature or change request into a concrete, reviewable plan before implementation starts — objective, user flow, acceptance criteria, architecture/security impact, analytics, test plan, files affected, rollback. Required before any non-trivial change; skip only for genuinely small, single-file fixes.
---

# ClaimLabs feature planning

Produce a written plan with these sections before touching code. Keep it
short — this is a working document, not a spec deliverable.

## 1. Objective
One sentence: what changes for the player or the business, and why now.

## 2. User flow
Walk the actual screens/states involved, naming the real files
(`src/pages/*.js` for DOM screens, `engine/game.js`'s `SCENE` states for
in-round flow). If the flow crosses the `engine`/`src` seam, say so
explicitly — that seam is a known source of silent gaps (see CLAUDE.md).

## 3. Acceptance criteria
Concrete and checkable, not aspirational. Prefer "TIME shows 30 at round
start, verified by screenshot" over "round time is correct." If the request
conflicts with what's actually in the code (this has happened before — see
ADR 0001), name the conflict and get it resolved before writing criteria
around one side of it.

## 4. Architecture impact
Does this touch the `engine`/`src` boundary? A `packages/` seam from the
target structure? A shared-engine vs. per-client-config boundary
(`claimlabs-configurable-reskins`)? If yes, note whether `docs/architecture/`
or an ADR needs updating alongside the code.

## 5. Security impact
Does this touch sessions, rewards, points, or campaign budgets? If yes,
this plan requires a `security-adversary` pass before merge — say so in the
plan, don't leave it implicit. Check
`docs/security/reward-wheel-compliance.md` if `WHEEL`/`resolve_run` are
anywhere near the change.

## 6. Analytics events
Does this need a new event, or does an existing one cover it? (No
analytics-events package/convention exists yet in this repo — if this is
the first one, that's itself worth flagging as a small architecture
decision, not just an implementation detail.)

## 7. Test plan
Since no automated suite exists yet (`claimlabs-testing`), specify exactly
what manual verification will happen and by which agent
(`qa-browser-engineer` for browser/gameplay, `security-adversary` for
reward/session paths) — "it should work" is not a test plan.

## 8. Files affected
List exact paths. Cross-check against `repository-cartographer` if you're
not certain a given constant/screen lives only where you think it does.

## 9. Rollback
For this repo (no Git yet, static/serverless deploy target): what's the
actual undo path? A config value revert in `engine/config.js`? A previous
Vercel deployment promotion? Say which, concretely — don't assume Git
revert is available until a repo exists.
