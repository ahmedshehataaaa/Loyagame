---
name: claimlabs-anti-cheat
description: Threat modelling and validation for Slice Rush against fake wins, modified browser code, impossible scores/timings, duplicate submissions, automation, OTP abuse, multi-account abuse, rate-limit bypass, and suspicious gameplay telemetry. Use when reviewing or extending anything score/session-related.
---

# ClaimLabs anti-cheat

## Threat model, mapped to what actually exists today

| Threat                                         | Current defense                                                                                                                                                                                           | Gap                                                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fake win submitted with no play                | `start-run` must be called first; `submit-run` requires its token                                                                                                                                         | None found — verify with `security-adversary` before trusting                                                                                                                                                                               |
| Modified browser code changing displayed score | Server doesn't trust displayed score directly — `resolve_run` re-checks bounds                                                                                                                            | Server checks _bounds_, not the actual gameplay — a modified client that reports a plausible-but-fake score within `max_plausible_score` would not be caught                                                                                |
| Impossible score for the time played           | `resolve_run` checks `p_duration` against `min_run_ms`                                                                                                                                                    | Only a floor on duration, and a ceiling on score — no correlation check between the _rate_ of scoring and what's physically possible given `FOODS` point values and spawn rate                                                              |
| Impossible timings (round finished too fast)   | `min_run_ms` setting                                                                                                                                                                                      | Same as above — bounds, not simulation                                                                                                                                                                                                      |
| Duplicate submission / replay                  | One-time `token`, `runs_token_uniq`, `FOR UPDATE` lock                                                                                                                                                    | None found                                                                                                                                                                                                                                  |
| Automation / bot play                          | None found                                                                                                                                                                                                | No CAPTCHA, no behavioral signal, no rate-based anomaly detection on a per-device/per-phone basis beyond the play-window limits                                                                                                             |
| OTP abuse                                      | Not applicable to current model — no OTP/WhatsApp verification found wired into `mcdonalds/` (was present in `fastfood-ninja` lineage; confirm current build's identity model before assuming OTP exists) | Verify actual current identity/verification flow, don't assume from lineage                                                                                                                                                                 |
| Multi-account abuse                            | `players` keyed by phone (`normalizePhone`)                                                                                                                                                               | No found check against, e.g., one device registering many phone numbers rapidly                                                                                                                                                             |
| Rate-limit bypass                              | `LIMITS.maxPlays`/`windowHrs`/`winLockoutHrs` in `engine/config.js`, enforced via `start_play` RPC server-side                                                                                            | `maxPlays` is currently set to effectively unlimited (`999999`) by deliberate design (July 2026 pivot, per the code comment) — confirm this is still the intended policy before treating a high play-rate as suspicious; it may be expected |
| Suspicious telemetry                           | Not found — no device fingerprinting, no anomaly flagging beyond `resolve_run`'s `suspicious` return field                                                                                                | Check what actually sets `suspicious=true` in the RPC and whether anything consumes it (dashboard? alerting?) before assuming it's monitored                                                                                                |

## What "impossible timing" checking should actually verify

A genuine replay-verification layer would check: given `FOODS` point
values, `spawn.*` rates, and `COMBO_WINDOW`, is the claimed
score/duration pair achievable at all, and does the claimed duration match
real human reaction-time bounds for the implied slice count? This does not
exist yet — `resolve_run`'s bounds check is a floor/ceiling, not a
simulation. Building this is real, non-trivial work; don't claim it's
"basically done" because bounds-checking exists.

## Procedure for any anti-cheat review

1. Read the actual current values of `min_run_ms`, `max_plausible_score`,
   `maxPlays`, `windowHrs`, `winLockoutHrs` from the live `settings` table
   (or its seed in `supabase/schema.sql`) — don't rely on this table's
   snapshot without re-checking, config is meant to be tunable without a
   redeploy.
2. Have `security-adversary` actually attempt each row's threat (see that
   agent's exploit checklist) rather than treating "a defense exists" as
   "the defense works."
3. If a real gap is found, report it precisely enough that
   `backend-reward-engineer` can act without re-deriving the threat model —
   don't just say "add anti-cheat."
