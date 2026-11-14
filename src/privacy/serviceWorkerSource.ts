import { shouldCacheRequest } from './cachePolicy.ts';

export function renderServiceWorker(assets: string[]): string {
  const unique = [...new Set(assets)];
  return `/* Webdra caches the application shell only. User binaries are never fetched or stored here. */
const ASSETS = ${JSON.stringify(unique)};
const CACHE = 'webdra-shell-v1';
const shouldCacheRequest = ${shouldCacheRequest.toString()};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!shouldCacheRequest(event.request.method, url.origin, self.location.origin, url.pathname, ASSETS)) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
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
