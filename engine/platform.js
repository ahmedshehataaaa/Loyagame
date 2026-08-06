/* ============================================================
   Platform — gates the game to phones & tablets, drives the
   "rotate your phone" hint, and provides the PHONE-FRAME
   viewport: on a real device the game fills the window; on a
   desktop (demo / Design Studio) it's letterboxed into a
   phone-sized frame so the interface always looks and lays out
   like a phone app — never a stretched desktop page.
   ============================================================ */

const Platform = (() => {
  // True only for actual phones/tablets (no dev overrides).
  function realDevice() {
    const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const ua = navigator.userAgent || '';
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle|PlayBook/i.test(ua);
    // iPadOS reports as a Mac but exposes multi-touch.
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return mobileUA || iPadOS || (touch && coarse);
  }

  function isMobileOrTablet() {
    // Dev/test overrides so the game can be opened on desktop on purpose.
    try { if (localStorage.getItem('ffn_dev') === '1') return true; } catch {}
    const q = new URLSearchParams(location.search);
    if (q.has('play') || q.has('desktop')) return true;
    if (q.get('design') === 'agency') return true; // Design Studio (agency)
    return realDevice();
  }

  /**
   * The box the game renders into. Real device → the full window.
   * Desktop → a centered phone-sized frame; PORTRAIT for menus and
   * LANDSCAPE during play (as if the player rotated the phone).
   */
  function viewport() {
    // Full-bleed on every target: real devices always filled their screen,
    // and the desktop/demo view now fills the whole window too (no centered
    // phone-frame letterbox). Menus follow the window's natural (landscape)
    // orientation on desktop; gameplay is landscape either way.
    return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  }

  // No desktop phone-frame bezel — the UI runs full-screen.
  document.body.classList.toggle('framed', false);

  let fadeTimer = null;

  // Show the rotate page in portrait — real devices only (the desktop
  // frame rotates itself, so the hint would be noise). It never blocks
  // input — it fades out so the (already-landscape) game stays playable.
  function updateRotateHint(orient) {
    const el = document.getElementById('rotate');
    if (!el) return;
    if (orient === 'portrait' && realDevice()) {
      el.classList.add('show');
      el.classList.remove('faded');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => el.classList.add('faded'), 2600);
    } else {
      el.classList.remove('show', 'faded');
      clearTimeout(fadeTimer);
    }
  }

  return { allowed: isMobileOrTablet, realDevice, viewport, updateRotateHint };
})();

// Expose for ES module consumers (top-level const does not attach to window).
window.Platform = Platform;
