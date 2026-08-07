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

   ⚠️ CLIENT-SIDE PLACEHOLDER — NOT THE PRODUCTION REWARD PATH.

   This resolves the round OUTCOME locally so the prototype is playable
   offline. It must never be the thing that decides a REWARD. The real
   backend (api/start-run + api/submit-run -> the row-locked `resolve_run`
   RPC) exists and is correct, but nothing in src/ currently calls it — the
   client that did was retired with _legacy-ui-backup/data.js. Porting it is
   Stage 4 of docs/audit/2026-08-07-production-readiness-audit.md, and it is
   the single highest-severity open finding (S1) in that audit.

   Until then, `won` here means only "survived the round", which is a claim
   the server must re-derive. No prize, code or point balance may be shown to
   a player on the strength of this object alone. */
window.LoyaltyData = {
  async submitRun(score, durationMs, meta = {}) {
    const best = Store.progress().bestScore;
    // Trust the engine's outcome when it supplies one; fall back to the
    // lives/time reading for older call sites.
    const survived =
      typeof meta.survived === 'boolean' ? meta.survived : meta.outcome === OUTCOME.SURVIVED;
    return {
      won: survived,
      outcome: meta.outcome ?? (survived ? OUTCOME.SURVIVED : OUTCOME.ELIMINATED),
      survived,
      livesRemaining: meta.livesRemaining ?? 0,
      itemsSliced: meta.itemsSliced ?? 0,
      bestCombo: meta.bestCombo ?? 0,
      newHigh: score > best,
      durationMs,
      // Rewards are server-issued. Nothing here may stand in for one.
      reward: null,
      rewardPending: survived,
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
