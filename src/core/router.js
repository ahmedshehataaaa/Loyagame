/* ============================================================
   Hash router.

   Hash-based (not History API) on purpose: this ships as static
   files to Netlify/Vercel and is also opened straight off disk,
   so deep links must survive a refresh with no server rewrite.
   ============================================================ */

const routes = new Map();
let notFoundRedirect = '/';
let current = null; // { path, cleanup }
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

  if (!entry) {
    navigate(notFoundRedirect, { replace: true });
    return;
  }

  // Tear the previous route down first — game loops and listeners
  // must not survive a route change.
  if (current?.cleanup) {
    try {
      current.cleanup();
    } catch (err) {
      console.warn('route cleanup failed', err);
    }
  }
  current = null;
  outlet.innerHTML = '';

  let cleanup = null;
  try {
    cleanup = (await entry.view(outlet)) || null;
  } catch (err) {
    console.error(`route "${path}" failed to render`, err);
    const copy = await errorScreen();
    // Built as nodes, not an innerHTML template, so translated copy can never
    // be parsed as markup.
    const wrap = document.createElement('div');
    wrap.className = 'screen bg-burst';
    const state = document.createElement('div');
    state.className = 'state';
    const glyph = document.createElement('span');
    glyph.className = 'state__glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '⚠️';
    const title = document.createElement('p');
    title.className = 'state__title';
    title.textContent = copy.title;
    const body = document.createElement('p');
    body.className = 'state__body';
    body.textContent = copy.body;
    const back = document.createElement('a');
    back.className = 'btn';
    back.href = '#/';
    back.style.maxWidth = '240px';
    back.textContent = copy.back;
    state.append(glyph, title, body, back);
    wrap.append(state);
    outlet.replaceChildren(wrap);
  }
  current = { path, cleanup };
  outlet.scrollTop = 0;
  document.dispatchEvent(new CustomEvent('route:changed', { detail: { path } }));
}

/* Error-screen copy is looked up lazily so the router does not import i18n at
   module scope — it must stay loadable even if i18n itself is what failed. */
async function errorScreen() {
  try {
    const { t } = await import('./i18n.js');
    return { title: t('err.title'), body: t('err.body'), back: t('err.back') };
  } catch {
    return {
      title: 'Something broke',
      body: 'This screen could not load. Try going back to the start.',
      back: 'Back to start',
    };
  }
}

export const Router = {
  /** @param {string} path @param {(el:HTMLElement)=>void|(()=>void)} view */
  add(path, view) {
    routes.set(path, { view });
    return Router;
  },

  start(el, { fallback = '/' } = {}) {
    outlet = el;
    notFoundRedirect = fallback;
    addEventListener('hashchange', render);
    if (!location.hash) location.replace('#/');
    render();
    return Router;
  },

  current: () => current?.path ?? parseHash(),

  /** Re-render the current route in place (used by the language switch). */
  repaint() {
    if (outlet) render();
    return Router;
  },
};

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) {
    render();
    return;
  }
  if (replace) location.replace(target);
  else location.hash = target;
}
