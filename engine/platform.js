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
   * The box the game renders into: the app shell, NOT the window.
   *
   * `#stage` is absolutely positioned inside `#app`, which is a phone-shaped
   * column (`max-width: --app-max`, centred) — so the window and the render box
   * are the same thing only on a phone. On a 1440/1920px desktop this returned
   * the full window width, the canvas was sized four times wider than the
   * column that contains it, and `#app`'s `overflow: hidden` clipped the rest:
   * the player saw a cropped, off-centre slice of the field and the game
   * appeared to overflow the screen. Measure the element that actually bounds
   * the canvas.
   *
   * Falls back to the window if the shell is missing or has no layout yet
   * (first paint, or a test mounting the engine without the shell) — a zero-size
   * viewport would make `resize()` divide into a degenerate scale.
   */
  function viewport() {
    const shell = document.getElementById('app');
    if (shell) {
      const w = shell.clientWidth;
      const h = shell.clientHeight;
      if (w > 0 && h > 0) return { x: 0, y: 0, w, h };
    }
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
