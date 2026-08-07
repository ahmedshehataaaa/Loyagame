/* ============================================================
   Platform — device gating and the render viewport.

   The game is PORTRAIT-native (ADR 0006), so there is no longer any
   orientation to force or hint about: the old "rotate your phone" flow
   and the desktop landscape phone-frame both existed only to serve a
   landscape-authored field, and both are gone.
   ============================================================ */

const Platform = (() => {
  // True only for actual phones/tablets (no dev overrides).
  function realDevice() {
    const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const ua = navigator.userAgent || '';
    const mobileUA =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle|PlayBook/i.test(
        ua,
      );
    // iPadOS reports as a Mac but exposes multi-touch.
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return mobileUA || iPadOS || (touch && coarse);
  }

  function isMobileOrTablet() {
    // Dev/test overrides so the game can be opened on desktop on purpose.
    // These only bypass the DEVICE GATE — they grant no points, rewards or
    // eligibility, and must never be extended to do so.
    try {
      if (localStorage.getItem('ffn_dev') === '1') return true;
    } catch {}
    const q = new URLSearchParams(location.search);
    if (q.has('play') || q.has('desktop')) return true;
    return realDevice();
  }

  /**
   * The box the game renders into: the full window on every target.
   * Portrait-native means desktop and mobile share one layout, so there is
   * no per-scene branching here any more.
   */
  function viewport() {
    return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  }

  /* Reduced motion, read live rather than cached: a player can change the OS
     setting mid-session, and the engine should honour it on the next frame
     without a reload. `src/main.js` mirrors the same signal into Store for the
     DOM layer, so both sides agree. */
  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  return { allowed: isMobileOrTablet, realDevice, viewport, reducedMotion };
})();

// Expose for ES module consumers (top-level const does not attach to window).
window.Platform = Platform;
