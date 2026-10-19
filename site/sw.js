// Bump before every deploy, otherwise installed phones keep the old cache.
const VERSION = 'crossfarm-v4';
const ASSETS = [
  './', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/api.js', './js/engine.js', './js/crops.js', './js/community.js', './js/analogues.js', './js/net.js',
  './data/farms.json', './data/ndvi-colormap.json', './data/analogue-grid.json', './data/analogue-grid.bin', './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Cache first for our own files (farm snapshots land in the cache on first use),
// network for everything else (tiles, APIs).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // shared data and the validation file change between deploys: always ask the network
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/validation.json')) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok && !res.redirected) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
