// Offline cache for the Home Screen app. Bump CACHE whenever any listed file changes.
const CACHE = 'nihon-no-tabi-v3';
const LOCAL = [
  './', './index.html', './manifest.json', './css/style.css',
  './js/app.js', './js/terrain.js', './js/ink-shader.js', './js/pins.js', './js/ui.js',
  './assets/web/washi.jpg', './assets/web/mist.png', './assets/web/card-bg.jpg',
  './assets/web/cap-left.png', './assets/web/cap-right.png', './assets/web/title.png',
  './assets/web/crest-tokyo.png', './assets/web/crest-kyoto.png', './assets/web/crest-nara.png',
  './assets/web/crest-osaka.png', './assets/web/crest-hakone.png', './assets/web/crest-fuji.png',
  './assets/web/icon-180.png', './assets/web/icon-192.png', './assets/web/icon-512.png',
  './data/central-japan-z9.bin', './data/hakone-fuji-z11.bin', './data/tokyo-z11.bin', './data/kansai-z11.bin',
  './data/places.json',
];
// libraries from the CDN: cached when possible, never blocks the install
const CDN = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
];

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(LOCAL);
  await Promise.all(CDN.map((u) => c.add(u).catch(() => {})));
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  // places.json is edited often: network first, cache as the fallback
  if (url.includes('/data/places.json')) {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
    if (res.ok && (url.includes('fonts.g') || url.includes('jsdelivr'))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
