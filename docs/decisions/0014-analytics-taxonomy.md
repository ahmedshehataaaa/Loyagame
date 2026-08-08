# 0014 — A closed, redacting analytics taxonomy with no vendor

Date: 2026-08-07
Status: Accepted (Stage 9 of the 2026-08-07 audit)

## Context

The brief asks for a consistent event set (19 named events) and says not to
expose personal or reward-sensitive information unnecessarily. The build had no
analytics at all, so there was nothing to correct — only a shape to choose.

Two failure modes are worth designing against specifically, because both are
cheap to prevent now and expensive to fix later:

1. **Name drift.** With a free-form `track(name, props)`, the same moment ends up
   logged three ways within weeks and every funnel built on it is wrong.
2. **Leakage by accretion.** A payload that starts clean acquires fields. This
   product handles phone numbers and redeemable prize codes, so a leak is a
   privacy incident, not a data-quality issue.

## Decision

### Names are a closed set

`EVENTS` is the only source of names. `track()` rejects anything else and warns
loudly — a typo'd event silently vanishing is how a funnel ends up wrong for a
quarter.

### Payloads are allow-listed per event

`ALLOWED[event]` lists the permitted keys; everything else is dropped and
counted. An allow-list fails safe (an undeclared field does not survive) where a
deny-list fails open (it misses `mobileNumber` when it only knows `phone`).

A second, independent `FORBIDDEN` check runs first, so mistakenly _adding_ a
sensitive key to an allow-list still cannot leak it. A unit test asserts no
allow-list contains a forbidden key.

Nested objects are dropped whole rather than walked — walking invites a
deep-redaction bug and nothing in the taxonomy needs it. Strings are capped at
120 characters.

### Prize keys yes, prize codes never

`prizeKey: 'fries'` is a business metric. The code that claims it is a bearer
token. This distinction is the single most important line in the taxonomy and is
enforced by both guards plus an e2e sweep.

### No vendor

There is no analytics provider chosen for this product, and choosing one is a
business decision (data residency, DPA, cost). Rather than invent an endpoint,
events buffer in a bounded in-memory queue behind a single `setSink()` seam.
Wiring a real vendor is one call and touches nothing else.

### Analytics can never affect gameplay

Every path swallows its own errors, nothing awaits a sink, a throwing sink
re-buffers rather than losing the event, and the buffer is capped at 100 so an
unattended tab cannot grow it forever. An e2e test installs a sink that throws on
every event and asserts the round still mounts and renders.

### `game_won` and `reward_issued` stay separate

They answer different questions (ADR 0004/0009): surviving is a skill outcome,
being issued a prize also needs the points threshold. A funnel must be able to
see survivors who got nothing — collapsing them would hide the most important
number in the reward economy.

## Consequences

- `docs/analytics-events.md` documents the taxonomy for whoever picks the vendor.
- `reward_copied` and `reward_redeemed` are defined but uninstrumented: copying
  needs a copy affordance on the wallet card, and redemption is a staff action
  against the server, so it belongs to the operator dashboard.
- `secondsElapsed` on pause/resume is allowed but unpopulated — the engine keeps
  elapsed time in a closure and does not publish it.

## Verification

- **157 unit tests** (+19). The redactor is proved against phone numbers under
  five spellings, prize codes under four key names, names, tokens, device ids, a
  forbidden key nested one level down, and unknown event names.
- **13 e2e tests.** These prove the _call sites_ use the taxonomy, which a
  redactor cannot guarantee on its own: a full journey is walked with a seeded
  phone number, a session token and a prize code in the API responses, and none
  of the three appears in any emitted event. Another asserts every emitted name
  is a known one, and another that a throwing vendor cannot break the game.
