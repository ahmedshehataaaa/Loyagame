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
 * @property {boolean} retryable    can the player meaningfully try the same action again
 * @property {number|null} orderPoints
 * @property {number|null} pointsThreshold
 */

export const REWARD_STATUS = /** @type {const} */ ({
  AWARDED: 'awarded',
  NOT_ELIGIBLE: 'not_eligible',
  ELIMINATED: 'eliminated',
  PENDING: 'pending',
  UNAVAILABLE: 'unavailable',
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
    retryable: status === 'pending' || status === 'error' || status === 'rate_limited',
    orderPoints: extra.orderPoints ?? null,
    pointsThreshold: extra.pointsThreshold ?? null,
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
    });
  }

  // Never attempted — treat exactly like an unreachable server, not like a denial.
  if (!apiResult) return deny(REWARD_STATUS.PENDING);

  if (!apiResult.ok) {
    switch (apiResult.kind) {
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

  // The server flags runs it distrusts. Never pay those out from the client,
  // even if it also said `won`.
  if (d.suspicious === true) {
    return deny(REWARD_STATUS.FLAGGED, { orderPoints, pointsThreshold });
  }

  if (d.won !== true) {
    return deny(REWARD_STATUS.NOT_ELIGIBLE, { orderPoints, pointsThreshold });
  }

  // `won: true` but no usable prize is a server contract violation. Fail closed:
  // showing a blank or placeholder prize is how players end up at a till with a
  // reward that does not exist.
  if (!validPrize(d.prize)) {
    return deny(REWARD_STATUS.ERROR, { orderPoints, pointsThreshold });
  }

  return {
    status: REWARD_STATUS.AWARDED,
    awarded: true,
    prize: { key: d.prize.key, label: d.prize.label },
    retryable: false,
    orderPoints,
    pointsThreshold,
  };
}
