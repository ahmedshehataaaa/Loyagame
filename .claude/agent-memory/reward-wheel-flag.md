# Reward wheel — open compliance flag

Full detail: `docs/security/reward-wheel-compliance.md`. Summary for quick
reference: `engine/config.js`'s `WHEEL.prizes` + `supabase/schema.sql`'s
`resolve_run` implement a **weighted random draw for real-value prizes**,
which this project's own inherited design doc calls sweepstakes/gambling
risk. A prior session already built and then reverted a compliant,
deterministic player-chosen alternative. Unresolved as of 2026-08-06 — a
legal/business decision, not an engineering one.

**Every agent that touches `WHEEL` or `resolve_run` should surface this,
every time, until it's actually resolved and this file is updated to say
so.** Don't let it go stale just because it's been mentioned before.
