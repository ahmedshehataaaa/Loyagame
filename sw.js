/* ============================================================
   Service worker — offline support for "Add to Home Screen".

   REWRITTEN 2026-08-07 (ADR 0013). The previous version was broken in two
   independent ways, both silent:

   1. Its shell list was the PRE-REFACTOR file layout (`./css/style.css`,
      `./js/main.js`, ...). None of those paths exist any more, and
      `cache.addAll()` rejects atomically if ANY entry 404s — so the worker
      never finished installing. Nothing was ever cached.
   2. It was never registered anywhere, so point 1 never even got the
      chance to fail visibly. The PWA manifest promised installability and
      offline play that did not exist.

   And a third problem it would have had once fixed: cache-first for
   *everything*, with no content hashing anywhere in the build. That serves
   stale JavaScript indefinitely after a deploy — the failure mode where a
   player's game is permanently a version behind and no amount of reloading
   helps.

   STRATEGY
   - **Code and markup** (HTML, JS, CSS, JSON): network-first with a cache
     fallback. A deploy is picked up on the next load; going offline still
     works from the last-known-good copy. This is the right way round for a
     project with no content hashing — correctness beats a few ms.
   - **Media** (images, fonts): cache-first. These are content-addressed in
     practice (a new sprite gets a new name) and are the bulk of the bytes.
   - **Never cache the reward API.** A cached `/api/*` response could show
     a player a prize decision that is not current. Always network, and let
     the client's own fail-closed handling deal with a failure.
   ============================================================ */

/* Bump on every deploy that changes shell files. Without content hashing this
   version string IS the cache-busting mechanism, so it is load-bearing. */
const VERSION = 'mcslice-2026-08-12a';
const SHELL_CACHE = `${VERSION}-shell`;
const MEDIA_CACHE = `${VERSION}-media`;

/* Everything needed for a cold offline boot. Kept deliberately short: it is
   hand-maintained, and the old one rotted precisely because it listed
   individual files that later moved. `install` tolerates misses now (see
   below), so a stale entry degrades rather than breaking the worker. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './engine/config.js',
  './engine/platform.js',
  './engine/audio.js',
  './engine/game.js',
  './src/main.js',
  './src/styles/tokens.css',
  './src/styles/base.css',
  './src/styles/components.css',
  './src/styles/screens.css',
  './src/styles/reference.css',
];

const isMedia = (url) => /\.(png|jpe?g|svg|webp|avif|woff2?|ttf)$/i.test(url.pathname);
const isApi = (url) => url.pathname.includes('/api/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(SHELL_CACHE);
      /* Added individually rather than with addAll(): addAll is atomic, so one
         moved file silently prevents the whole worker from installing — exactly
         how the previous version failed. A missing entry should cost that one
         file's offline availability, nothing more. */
      await Promise.all(
        SHELL.map((path) =>
          cache.add(path).catch((err) => {
            console.warn(`[sw] shell entry skipped: ${path}`, err);
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await self.caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => self.caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Cache-first, for bytes that do not change without changing name. */
async function cacheFirst(request) {
  const cache = await self.caches.open(MEDIA_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

/** Network-first, for code and markup that must not go stale after a deploy. */
async function networkFirst(request) {
  const cache = await self.caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && new URL(request.url).origin === self.location.origin) {
      cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // A navigation with nothing cached still needs somewhere to land.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Reward decisions must never come from a cache.
  if (isApi(url)) return;

  // Cross-origin (fonts) is cache-first; anything else same-origin follows the
  // media/code split.
  if (isMedia(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return; // let the network handle it

  event.respondWith(networkFirst(request));
});
