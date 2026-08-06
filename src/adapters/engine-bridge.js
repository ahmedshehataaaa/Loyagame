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

/** Score needed in one 60s round to trigger the victory screen. */
export const WIN_SCORE = 15000;

const handlers = new Map();   // event -> Set<fn>

export const GameEvents = {
  on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt)?.delete(fn);
  },
  emit(evt, payload) {
    handlers.get(evt)?.forEach((fn) => {
      try { fn(payload); } catch (err) { console.error(`GameEvents "${evt}" handler failed`, err); }
    });
  },
  clear() { handlers.clear(); },
};

/* ---- `UI` interface expected by engine/game.js -------------- */
window.UI = {
  show(sceneName) { GameEvents.emit('scene', sceneName); },
  showHome() { /* the router owns navigation; nothing to paint here */ },
  refreshHome() { GameEvents.emit('refresh'); },
  showChooser(score, result) { GameEvents.emit('ended', { score, won: true, ...result }); },
  showTryAgain(score, gap, playsLeft, newHigh) {
    GameEvents.emit('ended', { score, won: false, gap, playsLeft, newHigh });
  },
};

/* ---- `LoyaltyData` interface expected by engine/game.js ------
   The old build asked a server whether the run won. This client
   build resolves it locally against WIN_SCORE — there is no
   authoritative backend wired up for the McDonald's prototype. */
window.LoyaltyData = {
  async submitRun(score, durationMs) {
    const best = Store.progress().bestScore;
    return {
      won: score >= WIN_SCORE,
      gap: Math.max(0, WIN_SCORE - score),
      newHigh: score > best,
      durationMs,
    };
  },
  getPlaysLeft() { return null; },        // null = unlimited
  getHighScore() { return Store.progress().bestScore; },
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
  } catch { /* audio is non-critical */ }
}
