/*
 * Service worker. Its job is to make the app installable and to fail
 * gracefully offline — not to make it faster by remembering things.
 *
 * WHAT IT WILL NOT CACHE, and why:
 *
 *   Pages. Every page in this app is rendered for one signed-in user and
 *   full of one company's figures. A cached page would be served to whoever
 *   opens the app next on a shared machine, and would show last week's
 *   balances as though they were current. Both are worse than a blank
 *   screen, so navigations always go to the network.
 *
 *   /api. Same reason, and it is also where writes happen.
 *
 * WHAT IT DOES CACHE: build output under /_next/static, which is addressed
 * by content hash and so can never go stale, plus the icons and the offline
 * page. None of it is specific to a user and none of it is a figure.
 *
 * Bumping CACHE drops everything from the previous version on activation.
 */
const CACHE = 'gtg-static-v1';
const OFFLINE_URL = '/offline.html';

// Enough for the offline page to render on its own, with nothing to fetch.
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      // Take over tabs that were open before this worker existed, so the
      // offline fallback works without a reload.
      await self.clients.claim();
    })(),
  );
});

/** True for build output and brand assets: immutable, and nobody's data. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/brand/') ||
    url.pathname === '/favicon.ico' ||
    url.pathname === OFFLINE_URL
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that is not a plain read of this origin is left entirely alone,
  // which includes every form submission and server action.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        // Only a clean response is worth keeping: storing a 404 or a redirect
        // under an immutable URL would make a transient failure permanent.
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Deliberately not cached, whatever comes back.
          return await fetch(request);
        } catch {
          const cached = await caches.match(OFFLINE_URL);
          return (
            cached ??
            new Response('Offline.', {
              status: 503,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })(),
    );
  }
});
