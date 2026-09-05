const CACHE = 'teleprompt-v35';
const ASSETS = [
  './',
  './index.html',
  './parser.js',
  './manifest.webmanifest',
  './icon.svg',
  './app-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/rnnoise.js',
  './vendor/rnnoise.wasm',
  './vendor/webm-duration-fix.js',
  './vendor/int64-buffer.js',
  './vendor/ebml-block.js',
  './beauty/beauty-settings.js',
  './beauty/beauty-shaders.js',
  './beauty/skin-mask.js',
  './beauty/face-tracker.js',
  './beauty/beauty-gl.js',
  './beauty/beauty-app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  const accept = event.request.headers.get('accept') || '';
  const isHtml = event.request.mode === 'navigate' || accept.indexOf('text/html') !== -1;

  event.respondWith(isHtml ? freshFirst(event) : cacheFirst(event));
});

async function freshFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(event.request);
    if (response && response.ok) {
      cache.put(event.request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response && response.ok) {
    cachePut(event.request, response.clone());
  }
  return response;
}

function cachePut(request, response) {
  caches.open(CACHE).then((cache) => cache.put(request.clone(), response));
}