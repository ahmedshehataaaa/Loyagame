/* ============================================================
   Player state + persistence.

   Hash-routed static app with no backend session, so state lives
   in localStorage behind a versioned key. Every read is defensive:
   storage can be disabled (private mode), corrupted by a half-write,
   or left over from an older shape — none of which may throw.
   ============================================================ */

import { tenantKey } from './tenant.js';

/* Per tenant (ADR 0018): a restaurant's page never reads another's profile or
   cached balance. Unchanged at the site root. */
const KEY = tenantKey('mcslice.v1');

/** @typedef {{id:string,name:string,avatar?:string,isGuest:boolean}} PlayerProfile */
/** @typedef {{rewardPoints:number,bestScore:number,lastScore:number,gamesPlayed:number,
 *             redeemedRewardIds:string[],lastRun:null|object}} PlayerProgress */
/** @typedef {{soundEnabled:boolean,reducedMotion:boolean}} GameSettings */

const DEFAULTS = Object.freeze({
  profile: null,
  progress: {
    rewardPoints: 0,
    bestScore: 0,
    lastScore: 0,
    gamesPlayed: 0,
    redeemedRewardIds: [],
    lastRun: null,
  },
  settings: { soundEnabled: true, reducedMotion: false },
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

/** Coerce whatever is on disk into a valid state object. */
function sanitize(raw) {
  const out = clone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return out;

  const p = raw.profile;
  if (p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string') {
    out.profile = {
      id: p.id,
      name: p.name.slice(0, 24),
      avatar: typeof p.avatar === 'string' ? p.avatar : undefined,
      isGuest: bool(p.isGuest, true),
    };
  }

  const g = raw.progress;
  if (g && typeof g === 'object') {
    out.progress = {
      rewardPoints: Math.max(0, Math.floor(num(g.rewardPoints))),
      bestScore: Math.max(0, Math.floor(num(g.bestScore))),
      lastScore: Math.max(0, Math.floor(num(g.lastScore))),
      gamesPlayed: Math.max(0, Math.floor(num(g.gamesPlayed))),
      redeemedRewardIds: Array.isArray(g.redeemedRewardIds)
        ? g.redeemedRewardIds.filter((x) => typeof x === 'string').slice(0, 200)
        : [],
      lastRun: g.lastRun && typeof g.lastRun === 'object' ? g.lastRun : null,
    };
  }

  const s = raw.settings;
  if (s && typeof s === 'object') {
    out.settings = {
      soundEnabled: bool(s.soundEnabled, true),
      reducedMotion: bool(s.reducedMotion, false),
    };
  }
  return out;
}

function load() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return clone(DEFAULTS); // unreadable / disabled storage — run in memory
  }
}

let state = load();
const listeners = new Set();

/* Deliberately NOT part of the persisted `state`. See setLastReward(). */
let lastReward = null;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode */
  }
}
function emit() {
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* listener must not break writes */
    }
  });
}
function commit() {
  persist();
  emit();
}

export const Store = {
  get: () => state,
  profile: () => state.profile,
  progress: () => state.progress,
  settings: () => state.settings,
  isSignedIn: () => !!state.profile,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Sign in (or continue as guest) and persist the profile. */
  signIn({ name, isGuest = false, avatar }) {
    const clean =
      String(name || '')
        .trim()
        .slice(0, 24) || 'Player';
    state.profile = {
      id:
        state.profile?.id ||
        `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: clean,
      avatar,
      isGuest,
    };
    commit();
    return state.profile;
  },

  signOut() {
    state.profile = null;
    commit();
  },

  /**
   * Record a finished run; returns the derived result for the result screen.
   *
   * This deliberately does NOT touch `rewardPoints`. It used to mint
   * `floor(score / 10)` points per round straight into localStorage, which the
   * rewards catalogue then let the player spend on real products — a
   * spendable currency created entirely in the browser. Points now only ever
   * arrive from the server (`setOrderPoints`), earned by ordering. Score,
   * best score and games played stay local: they are statistics, not value.
   */
  recordRun({ score, itemsSliced, won }) {
    const s = Math.max(0, Math.floor(num(score)));
    const g = state.progress;
    const isBest = s > g.bestScore;

    g.lastScore = s;
    g.bestScore = Math.max(g.bestScore, s);
    g.gamesPlayed += 1;
    g.lastRun = {
      score: s,
      itemsSliced: Math.max(0, Math.floor(num(itemsSliced))),
      won: !!won,
      isBest,
      at: Date.now(),
    };
    commit();
    return g.lastRun;
  },

  /**
   * Stash the server's reward decision for the result screen to render.
   *
   * Held in memory only, never persisted: a reward outcome is the answer to one
   * specific submitted round, and a stale one rehydrated from localStorage on a
   * later visit is exactly how a player ends up shown a prize that was never
   * issued to them.
   */
  setLastReward(outcome) {
    lastReward = outcome ?? null;
    emit();
    return lastReward;
  },

  /** The reward outcome for the most recent round in THIS session, if any. */
  lastReward: () => lastReward,

  /**
   * Mirror the server's authoritative order-points balance.
   *
   * Write-only from a server response. This is the *only* way `rewardPoints`
   * may increase; there is deliberately no local accrual path.
   */
  setOrderPoints(n) {
    if (!Number.isFinite(n) || n < 0) return state.progress.rewardPoints;
    state.progress.rewardPoints = Math.floor(n);
    commit();
    return state.progress.rewardPoints;
  },

  /**
   * Redeeming is server-only and always fails here.
   *
   * This used to decrement a localStorage balance and mark the reward owned —
   * i.e. the browser granted a real product. Redemption has to happen inside a
   * server transaction that can enforce one-time use and a campaign budget
   * (`redeem_wheel_win()` in supabase/schema.sql already does exactly that).
   * Until the catalogue is wired to it (Stage 5), failing closed is the only
   * safe behaviour: a refused redemption is an inconvenience, a
   * browser-granted one is a financial loss.
   */
  redeem(reward) {
    if (!reward || !Number.isFinite(reward.cost) || reward.cost < 0) {
      return { ok: false, error: 'invalid_reward' };
    }
    if (state.progress.redeemedRewardIds.includes(reward.id)) {
      return { ok: false, error: 'already_redeemed' };
    }
    return { ok: false, error: 'server_required' };
  },

  toggleSound() {
    state.settings.soundEnabled = !state.settings.soundEnabled;
    commit();
    return state.settings.soundEnabled;
  },

  reset() {
    state = clone(DEFAULTS);
    commit();
  },
};
