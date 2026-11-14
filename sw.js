const CACHE = 'kubiraku-v3';
const ASSETS = [
  './',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        try {
          const url = new URL(req.url);
          const cacheControl = res.headers.get('Cache-Control') || '';
          if (res.ok && url.origin === self.location.origin && !/no-store/i.test(cacheControl)) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
        } catch (e) { /* キャッシュに残せなくても表示は続ける */ }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./')))
  );
});
