/* ============================================================
   Analytics event taxonomy.

   A closed list of event names and a REDACTING payload builder.

   Two rules, and the second is the one that needs enforcing in code
   rather than in a style guide:

   1. **Event names are a closed set.** A free-form `track(name, props)`
      call drifts within weeks — the same moment ends up logged as
      `game_start`, `gameStarted` and `start_game`, and every funnel built
      on it is wrong. `EVENTS` is the only source of names, and `track()`
      rejects anything not in it.

   2. **Payloads are allow-listed per event, not filtered per field.** The
      brief says not to expose personal or reward-sensitive information
      unnecessarily. A deny-list ("strip `phone`") fails the moment
      someone adds `mobileNumber`; an allow-list fails safe by default,
      because a field nobody declared simply does not survive.

   What is deliberately never sent: phone numbers, the player's name, the
   device token, prize CODES, and any reward identifier that could be
   redeemed. Prize *keys* are allowed — knowing that `fries` was won is a
   business metric; knowing the code that claims it is a bearer token.
   ============================================================ */

/** The complete taxonomy. Anything not here cannot be tracked. */
export const EVENTS = /** @type {const} */ ({
  CAMPAIGN_VIEWED: 'campaign_viewed',
  VERIFICATION_STARTED: 'verification_started',
  VERIFICATION_COMPLETED: 'verification_completed',
  INSTRUCTIONS_VIEWED: 'instructions_viewed',
  GAME_STARTED: 'game_started',
  GAME_PAUSED: 'game_paused',
  GAME_RESUMED: 'game_resumed',
  GAME_WON: 'game_won',
  GAME_LOST: 'game_lost',
  REWARD_ELIGIBLE: 'reward_eligible',
  REWARD_ISSUED: 'reward_issued',
  REWARD_VIEWED: 'reward_viewed',
  REWARD_COPIED: 'reward_copied',
  REWARD_REDEEMED: 'reward_redeemed',
  REPLAY_STARTED: 'replay_started',
  LEADERBOARD_VIEWED: 'leaderboard_viewed',
  ERROR_ENCOUNTERED: 'error_encountered',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
});

const NAMES = new Set(Object.values(EVENTS));
export const isKnownEvent = (name) => NAMES.has(name);

/**
 * Allowed property keys per event.
 *
 * Anything not listed is dropped, silently but countably (see
 * `lastRedactions` in transport.js). Every list is deliberately short: the
 * question for each field is "would a funnel or a business decision change
 * without it", and if not it does not belong in a payload that leaves the
 * device.
 */
export const ALLOWED = Object.freeze({
  [EVENTS.CAMPAIGN_VIEWED]: ['campaignId', 'locale', 'referrer'],
  [EVENTS.VERIFICATION_STARTED]: ['campaignId', 'method'],
  // NOT the number, and not whether a specific number succeeded — only that a
  // verification finished and whether it was accepted.
  [EVENTS.VERIFICATION_COMPLETED]: ['campaignId', 'method', 'accepted'],
  [EVENTS.INSTRUCTIONS_VIEWED]: ['campaignId', 'trigger'],
  [EVENTS.GAME_STARTED]: ['campaignId', 'rewardable', 'roundSeconds', 'lives'],
  [EVENTS.GAME_PAUSED]: ['campaignId', 'reason', 'secondsElapsed'],
  [EVENTS.GAME_RESUMED]: ['campaignId', 'secondsElapsed'],
  [EVENTS.GAME_WON]: ['campaignId', 'score', 'itemsSliced', 'bestCombo', 'durationMs'],
  [EVENTS.GAME_LOST]: ['campaignId', 'score', 'itemsSliced', 'bestCombo', 'durationMs'],
  [EVENTS.REWARD_ELIGIBLE]: ['campaignId', 'orderPoints', 'pointsThreshold'],
  // `prizeKey` yes, prize CODE never — the code is a bearer token.
  [EVENTS.REWARD_ISSUED]: ['campaignId', 'prizeKey', 'orderPoints'],
  [EVENTS.REWARD_VIEWED]: ['campaignId', 'prizeKey', 'status'],
  [EVENTS.REWARD_COPIED]: ['campaignId', 'prizeKey'],
  [EVENTS.REWARD_REDEEMED]: ['campaignId', 'prizeKey'],
  [EVENTS.REPLAY_STARTED]: ['campaignId', 'previousOutcome'],
  [EVENTS.LEADERBOARD_VIEWED]: ['campaignId', 'rank'],
  [EVENTS.ERROR_ENCOUNTERED]: ['campaignId', 'scope', 'kind', 'route'],
  [EVENTS.SUSPICIOUS_ACTIVITY]: ['campaignId', 'signal', 'scope'],
});

/**
 * Keys that must never appear in any payload, whatever an ALLOWED list says.
 *
 * A second, independent guard. The allow-list is the primary defence, but a
 * future edit could add `phone` to a list by mistake and nothing would object.
 * This makes that impossible rather than merely unlikely.
 */
export const FORBIDDEN = Object.freeze([
  'phone',
  'phonenumber',
  'mobile',
  'mobilenumber',
  'msisdn',
  'name',
  'playername',
  'fullname',
  'email',
  'code',
  'prizecode',
  'rewardcode',
  'coupon',
  'voucher',
  'token',
  'devicetoken',
  'sessiontoken',
  'deviceid',
  'password',
  'secret',
  'authorization',
  'address',
]);

const normalise = (key) =>
  String(key)
    .toLowerCase()
    .replace(/[^a-z]/g, '');
const FORBIDDEN_SET = new Set(FORBIDDEN);

/** Is this key one we refuse to transmit under any circumstances? */
export const isForbiddenKey = (key) => FORBIDDEN_SET.has(normalise(key));

/** Values are scalars only: an object could smuggle a forbidden key inside. */
function isScalar(v) {
  return (
    v === null ||
    typeof v === 'boolean' ||
    typeof v === 'number' ||
    typeof v === 'string' ||
    v === undefined
  );
}

/**
 * Build a redacted payload for an event.
 *
 * @param {string} name
 * @param {Record<string, unknown>} [props]
 * @returns {{ok:boolean, name:string, props:Record<string, unknown>, dropped:string[], reason?:string}}
 */
export function buildPayload(name, props = {}) {
  if (!isKnownEvent(name)) {
    return { ok: false, name, props: {}, dropped: [], reason: 'unknown_event' };
  }

  const allowed = new Set(ALLOWED[name] ?? []);
  /** @type {Record<string, unknown>} */
  const out = {};
  /** @type {string[]} */
  const dropped = [];

  for (const [key, value] of Object.entries(props ?? {})) {
    if (isForbiddenKey(key)) {
      dropped.push(key);
      continue;
    }
    if (!allowed.has(key)) {
      dropped.push(key);
      continue;
    }
    if (!isScalar(value)) {
      // Nested objects are dropped whole rather than walked: walking invites a
      // deep-redaction bug, and no event in the taxonomy needs one.
      dropped.push(key);
      continue;
    }
    if (value === undefined) continue;
    // Strings are length-capped so a stray message cannot become a payload.
    out[key] = typeof value === 'string' ? value.slice(0, 120) : value;
  }

  return { ok: true, name, props: out, dropped };
}
