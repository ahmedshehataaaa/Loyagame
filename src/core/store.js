/* ============================================================
   Player state + persistence.

   Hash-routed static app with no backend session, so state lives
   in localStorage behind a versioned key. Every read is defensive:
   storage can be disabled (private mode), corrupted by a half-write,
   or left over from an older shape — none of which may throw.
   ============================================================ */

const KEY = 'mcslice.v1';

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
    return clone(DEFAULTS);   // unreadable / disabled storage — run in memory
  }
}

let state = load();
const listeners = new Set();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ }
}
function emit() { listeners.forEach((fn) => { try { fn(state); } catch { /* listener must not break writes */ } }); }
function commit() { persist(); emit(); }

export const Store = {
  get: () => state,
  profile: () => state.profile,
  progress: () => state.progress,
  settings: () => state.settings,
  isSignedIn: () => !!state.profile,

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Sign in (or continue as guest) and persist the profile. */
  signIn({ name, isGuest = false, avatar }) {
    const clean = String(name || '').trim().slice(0, 24) || 'Player';
    state.profile = {
      id: state.profile?.id || `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: clean,
      avatar,
      isGuest,
    };
    commit();
    return state.profile;
  },

  signOut() { state.profile = null; commit(); },

  /** Record a finished run; returns the derived result for the victory screen. */
  recordRun({ score, itemsSliced, won }) {
    const s = Math.max(0, Math.floor(num(score)));
    const g = state.progress;
    const isBest = s > g.bestScore;
    const earned = Math.max(0, Math.floor(s / 10));   // 10 game points -> 1 reward point

    g.lastScore = s;
    g.bestScore = Math.max(g.bestScore, s);
    g.gamesPlayed += 1;
    g.rewardPoints += earned;
    g.lastRun = {
      score: s,
      itemsSliced: Math.max(0, Math.floor(num(itemsSliced))),
      earned,
      won: !!won,
      isBest,
      at: Date.now(),
    };
    commit();
    return g.lastRun;
  },

  /** Spend points on a reward. Returns {ok, error}. */
  redeem(reward) {
    const g = state.progress;
    if (!reward || !Number.isFinite(reward.cost) || reward.cost < 0) {
      return { ok: false, error: 'invalid_reward' };
    }
    if (g.redeemedRewardIds.includes(reward.id)) return { ok: false, error: 'already_redeemed' };
    if (g.rewardPoints < reward.cost) return { ok: false, error: 'insufficient_points' };

    g.rewardPoints -= reward.cost;
    g.redeemedRewardIds = g.redeemedRewardIds.concat(reward.id);
    commit();
    return { ok: true };
  },

  toggleSound() {
    state.settings.soundEnabled = !state.settings.soundEnabled;
    commit();
    return state.settings.soundEnabled;
  },

  /** Test/demo helper — grant points without playing. */
  grantPoints(n) {
    state.progress.rewardPoints += Math.max(0, Math.floor(num(n)));
    commit();
  },

  reset() { state = clone(DEFAULTS); commit(); },
};
