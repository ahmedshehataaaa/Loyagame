# Analytics events

Source of truth: `src/analytics/events.js`. This document explains the shape and
the rules; the code is the list.

## No vendor is wired

Deliberate (ADR 0014). Choosing a provider is a business/procurement decision —
data residency, DPA, cost — not an engineering one. Inventing an endpoint would
either dead-code itself or quietly ship player data somewhere nobody agreed to.

Events therefore collect into a bounded in-memory buffer and are delivered the
moment a sink is installed:

```js
import { setSink } from './src/analytics/index.js';
setSink((event) => myVendor.track(event.name, event.props));
```

That is the whole integration. Nothing else changes.

## Two rules, both enforced in code

**1. Event names are a closed set.** Free-form `track(name, props)` drifts within
weeks — the same moment gets logged as `game_start`, `gameStarted` and
`start_game`, and every funnel built on it is wrong. `track()` rejects any name
not in `EVENTS` and warns.

**2. Payloads are allow-listed per event, not deny-filtered.** A deny-list
("strip `phone`") fails the moment someone adds `mobileNumber`. An allow-list
fails safe: a field nobody declared does not survive. A second independent
`FORBIDDEN` check catches the case where someone mistakenly _adds_ a sensitive
key to an allow-list.

Nested objects are dropped whole rather than walked — walking invites a
deep-redaction bug, and no event needs it. Strings are capped at 120 chars so a
stray message cannot become a payload.

## Never transmitted

Phone numbers (under any spelling), player names, session or device tokens,
device ids, and **prize codes**.

Prize _keys_ are fine and prize _codes_ are not, and the distinction matters:
knowing `fries` was won is a business metric, whereas the code that claims it is
a bearer token. `tests/e2e/analytics.spec.js` walks a full journey with a seeded
phone number, a token and a prize code, then asserts none of them appear in any
emitted event.

## The events

| Event                    | When                                       | Payload                                                         |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| `campaign_viewed`        | App boot                                   | `campaignId`, `locale`, `referrer`                              |
| `verification_started`   | Sign-in screen mounts                      | `campaignId`, `method`                                          |
| `verification_completed` | Register returns, or guest chosen          | `campaignId`, `method`, `accepted`                              |
| `instructions_viewed`    | How-to-play card shown                     | `campaignId`, `trigger`                                         |
| `game_started`           | Round session resolved                     | `campaignId`, `rewardable`, `roundSeconds`, `lives`             |
| `game_paused`            | Pause button or tab hidden                 | `campaignId`, `reason`, `secondsElapsed`                        |
| `game_resumed`           | Resume                                     | `campaignId`, `secondsElapsed`                                  |
| `game_won`               | Survived the round                         | `campaignId`, `score`, `itemsSliced`, `bestCombo`, `durationMs` |
| `game_lost`              | Eliminated by hazards                      | same as `game_won`                                              |
| `reward_eligible`        | Survived but below the points threshold    | `campaignId`, `orderPoints`, `pointsThreshold`                  |
| `reward_issued`          | Server awarded a prize                     | `campaignId`, `prizeKey`, `orderPoints`                         |
| `reward_viewed`          | Prize shown in the wallet                  | `campaignId`, `prizeKey`, `status`                              |
| `reward_copied`          | Player copies a code                       | `campaignId`, `prizeKey`                                        |
| `reward_redeemed`        | Staff marks redeemed                       | `campaignId`, `prizeKey`                                        |
| `replay_started`         | Play again                                 | `campaignId`, `previousOutcome`                                 |
| `leaderboard_viewed`     | Leaderboard mounts                         | `campaignId`, `rank`                                            |
| `error_encountered`      | Uncaught error, failed route, reward fault | `campaignId`, `scope`, `kind`, `route`                          |
| `suspicious_activity`    | Server flagged a run                       | `campaignId`, `signal`, `scope`                                 |

### Why `game_won` and `reward_issued` are separate

They answer different questions (ADR 0004/0009). Surviving the round is a skill
outcome; being issued a prize also requires the order-points threshold. A funnel
has to be able to see **survivors who got nothing** — collapsing the two would
hide the single most important number in the reward economy.

## Not yet instrumented

- `reward_copied` and `reward_redeemed` are defined but have no call site.
  Copying needs a copy affordance on the wallet card, and redemption is a staff
  action against the server (`redeem_wheel_win`), so it belongs to the operator
  dashboard rather than the player app.
- `game_paused.secondsElapsed` / `game_resumed.secondsElapsed` are allowed but
  not populated: the engine keeps elapsed time in a closure and does not publish
  it. Worth adding when the engine's published state grows.
