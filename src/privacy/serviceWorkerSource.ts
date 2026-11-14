import { shouldCacheRequest } from './cachePolicy.ts';

/** FNV-1a over the precache list so a new build does not reuse a stale shell cache. */
export function shellCacheName(assets: readonly string[]): string {
  let hash = 2166136261;
  for (const asset of assets) {
    for (let index = 0; index < asset.length; index += 1) {
      hash ^= asset.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `webdra-shell-${(hash >>> 0).toString(16)}`;
}

export function renderServiceWorker(assets: string[]): string {
  const unique = [...new Set(assets)];
  const cacheName = shellCacheName(unique);
  const indexPath = unique.find((asset) => asset.endsWith('/index.html')) ?? unique.find((asset) => asset.endsWith('/')) ?? '/';
  return `/* Webdra caches the application shell only. User binaries are never fetched or stored here. */
const ASSETS = ${JSON.stringify(unique)};
const CACHE = ${JSON.stringify(cacheName)};
const INDEX_PATH = ${JSON.stringify(indexPath)};
const shouldCacheRequest = ${shouldCacheRequest.toString()};

self.addEventListener('install', (event) => {
  const files = ASSETS.filter((asset) => !asset.endsWith('/'));
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(files.map((asset) => new Request(asset, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('webdra-shell-') && key !== CACHE).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const navigation = event.request.mode === 'navigate' || url.pathname.endsWith('/index.html');
  if (navigation) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(INDEX_PATH, copy));
        }
        return response;
      }).catch(() => caches.match(INDEX_PATH).then((cached) => cached || Promise.reject(new Error('offline')))),
    );
    return;
  }
  if (!shouldCacheRequest(event.request.method, url.origin, self.location.origin, url.pathname, ASSETS)) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(new Request(event.request, { cache: 'reload' })).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })),
  );
});
`;
}
