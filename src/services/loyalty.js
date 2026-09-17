/* ============================================================
   Loyalty service — the ONLY thing that talks to the reward backend.

   Round lifecycle:
     startRound()  -> POST /start-run   server grants the play, returns a
                                        one-time token (and has already
                                        recorded the run, so a denied or
                                        abandoned round still counts)
     submitRound() -> POST /submit-run  presents that token; the server
                                        consumes it inside a row-locked
                                        transaction (resolve_run) and decides
                                        the prize

   Properties this file is responsible for upholding:
   • The client never decides a win, a prize, or a points balance.
   • A token is submitted at most once (see `consumed`), so a retry or a
     double-fire of the round-end event cannot request two prizes.
   • Every failure path resolves through reward-state.js, which cannot
     produce a prize.
   • With no backend configured the game stays playable, but explicitly
     without rewards — never with fabricated ones.
   ============================================================ */

import { postJson } from './api.js';
import { resolveRewardOutcome, REWARD_STATUS } from './reward-state.js';
import { OUTCOME } from '../game/round-rules.js';
import { Store } from '../core/store.js';
import { tenantKey } from '../core/tenant.js';

/* Per tenant (ADR 0018): a phone registered on one restaurant's page is never
   silently attributed rounds on another's, and each brand sees its own device
   id. Unchanged at the site root. */
const DEVICE_KEY = tenantKey('mcslice.device.v1');
const IDENTITY_KEY = tenantKey('mcslice.identity.v1');

/* ---- Device identity ---------------------------------------------------
   A stable per-device id. Used by the server for its own device-level
   eligibility checks; it is NOT a credential and grants nothing on its own. */
function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / storage disabled
  }
}
function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing we can do; the server will just see a fresh device each time */
  }
}

function newId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function deviceId() {
  let id = readStored(DEVICE_KEY);
  if (!id) {
    id = newId();
    writeStored(DEVICE_KEY, id);
  }
  return id;
}

/* ---- Identity ----------------------------------------------------------
   The phone the server attributes rounds to. Registration is UNVERIFIED by
   an explicit product decision (see api/register.mjs and ADR 0009) — this
   service must not imply otherwise anywhere in its naming or return values. */

/** @returns {{cc:string, phone:string}|null} */
export function getIdentity() {
  try {
    const raw = readStored(IDENTITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.cc === 'string' && typeof v?.phone === 'string') {
      return { cc: v.cc, phone: v.phone };
    }
  } catch {
    /* corrupt — treat as absent */
  }
  return null;
}

export function setIdentity(cc, phone) {
  const clean = { cc: String(cc), phone: String(phone).replace(/\D/g, '') };
  writeStored(IDENTITY_KEY, JSON.stringify(clean));
  return clean;
}

export function clearIdentity() {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Register (or re-claim) a phone number with the backend.
 * @returns {Promise<import('./api.js').ApiResult<any>>}
 */
export async function register({ cc, phone, consent }) {
  const result = await postJson('/register', { cc, phone, consent: !!consent });
  if (result.ok) setIdentity(cc, phone);
  return result;
}

/* ---- Phone verification (OTP) ------------------------------------------
   The code is generated, held and compared SERVER-SIDE. Nothing here knows
   the correct code, and nothing here decides whether verification passed —
   the same rule the reward path follows, for the same reason: a check the
   browser can answer is a check an attacker can answer.

   Identity stays local until the server says the number is verified, so a
   half-finished sign-in cannot attribute a prize to a number nobody proved
   they hold. */

/**
 * Ask the server to send a one-time code.
 * @returns {Promise<import('./api.js').ApiResult<any>>}
 */
export async function sendOtp({ cc, phone }) {
  return postJson('/send-otp', { cc, phone });
}

/**
 * Present a code for checking. Identity is stored only on a verified pass.
 * @returns {Promise<import('./api.js').ApiResult<any>>}
 */
export async function verifyOtp({ cc, phone, code }) {
  const result = await postJson('/verify-otp', { cc, phone, code });
  if (result.ok && result.data?.verified === true) setIdentity(cc, phone);
  return result;
}

/* ---- Round session ----------------------------------------------------- */

/**
 * @typedef {object} RoundSession
 * @property {string|null} token     one-time token from the server, if granted
 * @property {boolean} granted       did the server authorise a rewardable round
 * @property {boolean} rewardable    granted AND we have a token to submit
 * @property {string|null} denyReason server's reason when not granted
 * @property {string|null} nextPlayAt ISO time the player may try again
 * @property {import('./api.js').ApiErrorKind|null} failure transport failure, if any
 * @property {boolean} consumed      has this token already been submitted
 */

/** @type {RoundSession|null} */
let current = null;

/** The session the current round is bound to (read-only view for the UI). */
export const currentSession = () => current;

/**
 * Ask the server for a round.
 *
 * A round with no server grant is still playable — it is simply not
 * rewardable, and `rewardable: false` is how the UI knows to say so up front
 * rather than implying a prize is coming.
 *
 * @returns {Promise<RoundSession>}
 */
export async function startRound() {
  const identity = getIdentity();

  // No identity means nothing to attribute a prize to. Play unranked.
  if (!identity) {
    current = {
      token: null,
      granted: false,
      rewardable: false,
      denyReason: 'no_identity',
      nextPlayAt: null,
      failure: null,
      consumed: false,
    };
    return current;
  }

  const result = await postJson('/start-run', {
    cc: identity.cc,
    phone: identity.phone,
    device: deviceId(),
  });

  if (!result.ok) {
    current = {
      token: null,
      granted: false,
      rewardable: false,
      denyReason: null,
      nextPlayAt: null,
      failure: result.kind,
      consumed: false,
    };
    return current;
  }

  const d = result.data ?? {};
  const granted = d.granted === true && typeof d.token === 'string' && d.token.length > 0;
  current = {
    token: granted ? d.token : null,
    granted,
    rewardable: granted,
    denyReason: granted ? null : (d.reason ?? 'not_granted'),
    nextPlayAt: d.nextPlayAt ?? null,
    failure: null,
    consumed: false,
  };
  return current;
}

/**
 * Submit a finished round and resolve what the player may be shown.
 *
 * @param {object} run
 * @param {number} run.score
 * @param {number} run.durationMs
 * @param {'survived'|'eliminated'} run.outcome
 * @returns {Promise<import('./reward-state.js').RewardOutcome>}
 */
export async function submitRound({ score, durationMs, outcome }) {
  // Never spend a token on a lost round — the server would consume it and the
  // player would burn an eligibility slot for a round that cannot pay out.
  if (outcome !== OUTCOME.SURVIVED) {
    return resolveRewardOutcome({ roundOutcome: outcome, apiResult: null });
  }

  const session = current;

  // Nothing to present. Distinguish "no backend at all" (practice round) from
  // "backend exists but we never got a token" (pending), because the first is
  // an expected build state and the second is a fault.
  if (!session || !session.token) {
    const kind =
      session?.failure ??
      (session?.denyReason === 'no_identity'
        ? 'no_identity'
        : session?.granted === false
          ? 'not_configured'
          : null);
    return resolveRewardOutcome({
      roundOutcome: outcome,
      apiResult: kind ? { ok: false, kind } : null,
    });
  }

  // One token, one submission. Guards a double-fired round-end event and any
  // retry the UI might offer, so a single round can never request two prizes.
  if (session.consumed) {
    return resolveRewardOutcome({
      roundOutcome: outcome,
      apiResult: { ok: false, kind: 'invalid_token' },
    });
  }
  session.consumed = true;

  const result = await postJson('/submit-run', {
    token: session.token,
    score: Math.round(score),
    durationMs: Math.round(durationMs),
    device: deviceId(),
    // A CLAIM, not an instruction. The server re-derives survival from the
    // round duration it timed itself and ignores this if they disagree.
    survived: outcome === OUTCOME.SURVIVED,
  });

  /* Mirror the balance HERE, from the response this function actually
     received — this is the only place in the app that has seen the genuine
     server reply. The result object then travels onward through the engine's
     UI bridge, which is page-scriptable; an adversarial test proved that
     letting the screen layer write the balance from that object let a forged
     `orderPoints` persist to localStorage. The service is the single writer. */
  if (result.ok && Number.isFinite(result.data?.orderPoints)) {
    Store.setOrderPoints(result.data.orderPoints);
  }

  return resolveRewardOutcome({ roundOutcome: outcome, apiResult: result });
}

/** Drop the session (route teardown), so a stale token can never be reused. */
export function endRound() {
  current = null;
}

export { REWARD_STATUS };
