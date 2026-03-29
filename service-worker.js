const CACHE_NAME = 'mision-9d-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './mision_9_dias_header_1774779453951.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
