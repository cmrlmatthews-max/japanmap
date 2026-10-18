// Offline cache for the Home Screen app.
// The page, scripts, styles and data files load network first: with a connection the app is always the newest version; offline it uses the saved copy.
// Big files (terrain .bin, images) load cache first, for speed. Bump CACHE when a big file or the LOCAL list changes.
const CACHE = 'nihon-no-tabi-v15';
const NET_TIMEOUT_MS = 4000;            // a slow network falls back to the saved copy after this
const LOCAL = [
  './', './index.html', './manifest.json', './css/style.css', './css/route.css', './css/trip.css', './css/tips.css', './css/inset.css', './css/legend.css', './css/list.css',
  './js/app.js', './js/terrain.js', './js/ink-shader.js', './js/pins.js', './js/ui.js', './js/route.js', './js/trip.js', './js/tips.js', './js/icons.js',
  './js/flatmap.js', './js/inset.js', './js/marker.js', './js/art.js', './js/legend.js', './js/itinerary.js', './js/list.js',
  './assets/web/washi.jpg', './assets/web/itinerary-bg.jpg', './assets/web/card-bg.jpg', './assets/web/wave.png', './assets/web/fuji-ink.png',
  './assets/web/title.png', './assets/web/traveler.png',
  './assets/web/crest-tokyo.png', './assets/web/crest-kyoto.png', './assets/web/crest-nara.png',
  './assets/web/crest-osaka.png', './assets/web/crest-hakone.png', './assets/web/crest-fuji.png',
  './assets/web/icon-180.png', './assets/web/icon-192.png', './assets/web/icon-512.png',
  './data/central-japan-z9.bin', './data/hakone-fuji-z11.bin', './data/tokyo-z11.bin', './data/kansai-z11.bin',
  './data/places.json', './data/rail.geojson', './data/itinerary-cade.json', './data/itinerary-casey.json',
  './data/japan-coast.json', './data/art.json',
];
// paintings: cached when they exist, never block the install (see data/art.json)
const ART = ['./assets/web/art-wave-fuji.png', './assets/web/art-koi.png', './assets/web/art-crane.png', './assets/web/art-pine.png', './assets/web/art-kabuto.png'];
// libraries from the CDN: cached when possible, never blocks the install
const CDN = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
];

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(LOCAL.map((u) => new Request(u, { cache: 'reload' })));   // skip the browser's HTTP cache (GitHub Pages keeps files 10 min), so a new version never saves stale files
  await Promise.all(CDN.concat(ART).map((u) => c.add(u).catch(() => {})));
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

// network first: fresh file when online (and save it), the saved copy when offline or slow
function networkFirst(req, fallbackUrl) {
  return new Promise((resolve) => {
    let done = false;
    const fromCache = () => caches.match(req, { ignoreSearch: true })
      .then((r) => r || (fallbackUrl ? caches.match(fallbackUrl) : undefined));
    const timer = setTimeout(() => { fromCache().then((r) => { if (r && !done) { done = true; resolve(r); } }); }, NET_TIMEOUT_MS);
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      clearTimeout(timer); if (!done) { done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then((r) => { if (!done) { done = true; resolve(r || Response.error()); } });
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  // the page itself
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, './index.html')); return; }
  // code and small data from this site: html, js, css, json, geojson, manifest
  if (same && /\.(html|js|css|json|geojson)$/i.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
  // everything else (terrain .bin, images, fonts, the CDN library): cache first
  e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
    if (res.ok && (same || url.hostname.includes('fonts.g') || url.hostname.includes('jsdelivr'))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
