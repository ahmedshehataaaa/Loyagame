/* Pasta Ninja — service worker (offline support for "Add to Home Screen").
   Cache-first for the app shell; network-first for everything else. */
const CACHE = 'glaze-rush-v1';
const SHELL = [
  './', './index.html',
  './css/style.css',
  './js/platform.js', './js/config.js', './js/design-overrides.js', './js/theme.js',
  './js/schedule.js', './js/i18n.js',
  './js/data.js', './js/audio.js', './js/ui.js', './js/game.js', './js/main.js',
  './icon.svg', './manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(res => {
      // Cache same-origin successful responses for next time.
      if (res.ok && new URL(request.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
