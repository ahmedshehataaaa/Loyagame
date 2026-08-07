/* ============================================================
   Engine bridge.

   engine/game.js is the preserved canvas slicing engine. It calls
   out to two globals — `UI` and `LoyaltyData` — which used to be
   the old screen system. Rather than rewrite the engine, we satisfy
   those interfaces here and re-publish everything as events the new
   pages subscribe to. This keeps the engine framework-agnostic and
   the UI layer replaceable.
   ============================================================ */
import { Store } from '../core/store.js';
import { OUTCOME } from '../game/round-rules.js';
import { submitRound } from '../services/loyalty.js';

/* Last-resort reward outcome for an unexpected throw. Deliberately identical
   in shape to a RewardOutcome so no caller needs a null check, and
   deliberately award-free. */
const FAILED_REWARD = Object.freeze({
  status: 'error',
  awarded: false,
  prize: null,
  retryable: true,
  title: 'Something went wrong',
  message: "We couldn't confirm a prize for this round. No prize has been issued.",
  orderPoints: null,
  pointsThreshold: null,
});

const handlers = new Map(); // event -> Set<fn>

export const GameEvents = {
  on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt)?.delete(fn);
  },
  emit(evt, payload) {
    handlers.get(evt)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`GameEvents "${evt}" handler failed`, err);
      }
    });
  },
  clear() {
    handlers.clear();
  },
};

/* ---- `UI` interface expected by engine/game.js -------------- */
window.UI = {
  show(sceneName) {
    GameEvents.emit('scene', sceneName);
  },
  showHome() {
    /* the router owns navigation; nothing to paint here */
  },
  refreshHome() {
    GameEvents.emit('refresh');
  },
  /* Called by the engine only when a displayed value changed, replacing the
     100ms poll the HUD used to run. */
  hud(state) {
    GameEvents.emit('hud', state);
  },
  showChooser(score, result) {
    GameEvents.emit('ended', { score, ...result, won: true });
  },
  showTryAgain(score, _gap, playsLeft, newHigh) {
    // `gap` was "points short of the win threshold" under the old score-based
    // win rule; survival replaced it (ADR 0004) so there is no gap to report.
    GameEvents.emit('ended', {
      score,
      won: false,
      survived: false,
      outcome: OUTCOME.ELIMINATED,
      playsLeft,
      newHigh,
    });
  },
};

/* ---- `LoyaltyData` interface expected by engine/game.js ------

   A thin adapter over src/services/loyalty.js, which is now the only code
   that talks to the reward backend. This used to resolve the win locally as
   `score >= 15000` and made no network call at all — audit finding S1, the
   highest-severity issue in
   docs/audit/2026-08-07-production-readiness-audit.md.

   Two distinct outcomes come back, and conflating them was precisely the old
   bug:
     • `won`    — did the player SURVIVE the round (ADR 0004)? Decides which
                  screen shows next. Derived from real round state.
     • `reward` — what, if anything, the SERVER issued. Always a RewardOutcome;
                  `reward.prize` is non-null only when the server explicitly
                  awarded a named prize. */
window.LoyaltyData = {
  async submitRun(score, durationMs, meta = {}) {
    const best = Store.progress().bestScore;
    // Trust the engine's outcome when it supplies one; fall back to the
    // lives/time reading for older call sites.
    const survived =
      typeof meta.survived === 'boolean' ? meta.survived : meta.outcome === OUTCOME.SURVIVED;
    const outcome = meta.outcome ?? (survived ? OUTCOME.SURVIVED : OUTCOME.ELIMINATED);

    // A reward-service failure must never break the round-end flow: the player
    // always reaches a result screen, just never a fabricated prize.
    let reward;
    try {
      reward = await submitRound({ score, durationMs, outcome });
    } catch (err) {
      console.error('reward submission failed', err);
      reward = FAILED_REWARD;
    }

    return {
      won: survived,
      outcome,
      survived,
      livesRemaining: meta.livesRemaining ?? 0,
      itemsSliced: meta.itemsSliced ?? 0,
      bestCombo: meta.bestCombo ?? 0,
      newHigh: score > best,
      durationMs,
      reward,
    };
  },
  getPlaysLeft() {
    return null;
  }, // null = unlimited
  getHighScore() {
    return Store.progress().bestScore;
  },
};

/* ---- Sound honours the persisted setting -------------------- */
export function applySoundSetting() {
  const on = Store.settings().soundEnabled;
  try {
    if (window.Sound?.setMuted) window.Sound.setMuted(!on);
    else if (window.Sound?.toggleMute) {
      // audio.js exposes a toggle, so only flip when it disagrees.
      if (typeof window.Sound.isMuted === 'function' && window.Sound.isMuted() === on) {
        window.Sound.toggleMute();
      }
    }
  } catch {
    /* audio is non-critical */
  }
}
