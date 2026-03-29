const CACHE_NAME = 'mision-kora-v9'; // v6
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './mision_header_v2.jpg'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Skip cross-origin requests (like Google Scripts) to avoid CORS/ServiceWorker issues
  if (!e.request.url.startsWith(self.location.origin)) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .catch(() => caches.match(e.request))
      .then((response) => {
        if (!response) {
          // Fallback to fetch from network if cache misses, or just let error propagate
          return fetch(e.request);
        }
        return response;
      })
  );
});
