/* ============================================================
   Reward outcome resolution.

   THE INVARIANT THIS FILE EXISTS TO ENFORCE:
   a prize is returned if and only if the SERVER explicitly said
   `won: true` and named it. Every other input — a denial, a timeout, a
   404, a malformed body, a missing prize object, an unconfigured API, a
   round that ended in elimination — resolves to a state with
   `prize === null` and `awarded === false`.

   Player-facing copy is NOT here: it lives in i18n keyed by status
   (`reward.<status>.title` / `.msg`), so this stays pure, locale-free and
   testable, and so Arabic gets every state for free.

   This is deliberately a pure function over (round outcome, API result)
   so the invariant can be proved exhaustively in tests rather than
   argued about. The bug it replaces was structural: the client computed
   `won = score >= 15000` locally and the UI trusted it, so a reward
   screen could appear with no server involvement at all.
   ============================================================ */

import { OUTCOME } from '../game/round-rules.js';

/**
 * @typedef {'awarded'|'not_eligible'|'eliminated'|'pending'|'unavailable'
 *   |'session_expired'|'rate_limited'|'flagged'|'error'} RewardStatus
 */

/**
 * @typedef {object} RewardOutcome
 * @property {RewardStatus} status
 * @property {boolean} awarded      true only for a server-issued prize
 * @property {null|{key:string,label:string}} prize
 * @property {string|null} code    the coupon code, when the server minted one
 * @property {any[]|null} wheel    the server's authoritative segment order
 * @property {boolean} retryable    can the player meaningfully try the same action again
 * @property {number|null} orderPoints
 * @property {number|null} pointsThreshold
 * @property {'order_points'|'score'} gate  what pointsThreshold is measured against
 * @property {number|null} score    this round's score, as the server recorded it
 */

export const REWARD_STATUS = /** @type {const} */ ({
  AWARDED: 'awarded',
  NOT_ELIGIBLE: 'not_eligible',
  ELIMINATED: 'eliminated',
  PENDING: 'pending',
  UNAVAILABLE: 'unavailable',
  NOT_SIGNED_IN: 'not_signed_in',
  SESSION_EXPIRED: 'session_expired',
  RATE_LIMITED: 'rate_limited',
  FLAGGED: 'flagged',
  ERROR: 'error',
});

/** Build a non-award outcome. Centralised so `prize:null` can never be forgotten. */
function deny(status, extra = {}) {
  return {
    status,
    awarded: false,
    prize: null,
    // A denial has no code by definition; naming it here keeps every consumer
    // free of null-checks and makes a leak impossible to write by accident.
    code: null,
    wheel: extra.wheel ?? null,
    retryable: status === 'pending' || status === 'error' || status === 'rate_limited',
    orderPoints: extra.orderPoints ?? null,
    pointsThreshold: extra.pointsThreshold ?? null,
    gate: gateOf(extra.gate),
    score: extra.score ?? null,
  };
}

/** Is this a usable server-issued prize? Both fields must be real strings. */
function validPrize(prize) {
  return (
    !!prize &&
    typeof prize === 'object' &&
    typeof prize.key === 'string' &&
    prize.key.length > 0 &&
    typeof prize.label === 'string' &&
    prize.label.length > 0
  );
}

const num = (v) => (Number.isFinite(v) ? v : null);

/** Anything but an explicit 'score' is the stricter order-points rule. */
const gateOf = (v) =>
  /** @type {'order_points'|'score'} */ (v === 'score' ? 'score' : 'order_points');

/**
 * Resolve what the player may be told about a reward.
 *
 * @param {object} input
 * @param {'survived'|'eliminated'} input.roundOutcome  from the tested round rules
 * @param {import('./api.js').ApiResult<any>|null} input.apiResult  submit-run result, or null if never attempted
 * @returns {RewardOutcome}
 */
export function resolveRewardOutcome({ roundOutcome, apiResult }) {
  // Elimination short-circuits: a lost round is never reward-eligible, so a
  // server award for one would itself be a bug worth refusing to display.
  if (roundOutcome !== OUTCOME.SURVIVED) {
    return deny(REWARD_STATUS.ELIMINATED, {
      orderPoints: apiResult?.ok ? num(apiResult.data?.orderPoints) : null,
      pointsThreshold: apiResult?.ok ? num(apiResult.data?.pointsThreshold) : null,
      gate: apiResult?.ok ? apiResult.data?.gate : undefined,
      score: apiResult?.ok ? num(apiResult.data?.score) : null,
    });
  }

  // Never attempted — treat exactly like an unreachable server, not like a denial.
  if (!apiResult) return deny(REWARD_STATUS.PENDING);

  if (!apiResult.ok) {
    switch (apiResult.kind) {
      /* A player with no identity is NOT a broken build. Both used to collapse
         to `not_configured`, so a guest who survived a round was told "Rewards
         are not available in this build" — which is false, blames the app, and
         hides the one action that would fix it. They are separate now:
         `no_identity` is a person who has not signed in; `not_configured` is a
         build with the reward API switched off. */
      case 'no_identity':
        return deny(REWARD_STATUS.NOT_SIGNED_IN);
      case 'not_configured':
        return deny(REWARD_STATUS.UNAVAILABLE);
      case 'invalid_token':
        return deny(REWARD_STATUS.SESSION_EXPIRED);
      case 'rate_limited':
        return deny(REWARD_STATUS.RATE_LIMITED);
      case 'offline':
      case 'timeout':
      case 'network':
        return deny(REWARD_STATUS.PENDING);
      default:
        return deny(REWARD_STATUS.ERROR);
    }
  }

  const d = apiResult.data ?? {};
  const orderPoints = num(d.orderPoints);
  const pointsThreshold = num(d.pointsThreshold);
  const gate = gateOf(d.gate);
  const score = num(d.score);

  // The server flags runs it distrusts. Never pay those out from the client,
  // even if it also said `won`.
  if (d.suspicious === true) {
    return deny(REWARD_STATUS.FLAGGED, {
      orderPoints,
      pointsThreshold,
      gate,
      score,
      wheel: d.wheel,
    });
  }

  if (d.won !== true) {
    return deny(REWARD_STATUS.NOT_ELIGIBLE, {
      orderPoints,
      pointsThreshold,
      gate,
      score,
      wheel: d.wheel,
    });
  }

  // `won: true` but no usable prize is a server contract violation. Fail closed:
  // showing a blank or placeholder prize is how players end up at a till with a
  // reward that does not exist.
  if (!validPrize(d.prize)) {
    return deny(REWARD_STATUS.ERROR, { orderPoints, pointsThreshold, gate, score });
  }

  return {
    status: REWARD_STATUS.AWARDED,
    awarded: true,
    prize: { key: d.prize.key, label: d.prize.label },
    // Only ever the server's own string. Never generated, never derived.
    code: typeof d.code === 'string' && d.code.length ? d.code : null,
    wheel: Array.isArray(d.wheel) ? d.wheel : null,
    retryable: false,
    orderPoints,
    pointsThreshold,
    gate,
    score,
  };
}
