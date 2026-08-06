/* ============================================================
   Hash router.

   Hash-based (not History API) on purpose: this ships as static
   files to Netlify/Vercel and is also opened straight off disk,
   so deep links must survive a refresh with no server rewrite.
   ============================================================ */

const routes = new Map();
let notFoundRedirect = '/';
let current = null;          // { path, cleanup }
let outlet = null;

/** Normalise "#/play?x=1" -> "/play". */
function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const path = raw.split('?')[0] || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

async function render() {
  const path = parseHash();
  const entry = routes.get(path);

  if (!entry) { navigate(notFoundRedirect, { replace: true }); return; }

  // Tear the previous route down first — game loops and listeners
  // must not survive a route change.
  if (current?.cleanup) {
    try { current.cleanup(); } catch (err) { console.warn('route cleanup failed', err); }
  }
  current = null;
  outlet.innerHTML = '';

  let cleanup = null;
  try {
    cleanup = await entry.view(outlet) || null;
  } catch (err) {
    console.error(`route "${path}" failed to render`, err);
    outlet.innerHTML = `
      <div class="screen bg-burst">
        <div class="state">
          <span class="state__glyph">⚠️</span>
          <p class="state__title">Something broke</p>
          <p class="state__body">This screen could not load. Try going back to the start.</p>
          <a class="btn" href="#/" style="max-width:240px">Back to start</a>
        </div>
      </div>`;
  }
  current = { path, cleanup };
  outlet.scrollTop = 0;
  document.dispatchEvent(new CustomEvent('route:changed', { detail: { path } }));
}

export const Router = {
  /** @param {string} path @param {(el:HTMLElement)=>void|(()=>void)} view */
  add(path, view) { routes.set(path, { view }); return Router; },

  start(el, { fallback = '/' } = {}) {
    outlet = el;
    notFoundRedirect = fallback;
    addEventListener('hashchange', render);
    if (!location.hash) location.replace('#/');
    render();
    return Router;
  },

  current: () => current?.path ?? parseHash(),
};

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) { render(); return; }
  if (replace) location.replace(target);
  else location.hash = target;
}
