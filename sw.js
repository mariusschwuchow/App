const CACHE = 'standort-bewertung-v19';
const ASSETS = ['./', 'index.html', 'style.css', 'moon.js', 'conditions.js', 'places.js', 'app.js', 'analysis.js', 'stats.js', 'session.js', 'view.js', 'tools.js', 'manifest.webmanifest', 'icon.svg',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) =>
    c.addAll(ASSETS.map((url) => new Request(url, { cache: 'no-cache' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

// App-Dateien: zuerst Netzwerk, bei Offline aus dem Cache. 'no-cache' umgeht den
// HTTP-Zwischenspeicher des Browsers (GitHub Pages: bis zu 10 Minuten), damit nach
// einem Update sofort alle Dateien in der neuen Version geladen werden.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
