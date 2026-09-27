const SHELL = 'job-mailer-shell-v2';
const SHARED = 'job-mailer-shared';
const FILES = ['./', './index.html', './app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== SHARED).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Content shared from LinkedIn or a screenshot arrives here as a POST.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const text = ['title', 'text', 'url'].map((k) => form.get(k)).filter(Boolean).join('\n');
      const image = form.get('image');
      const cache = await caches.open(SHARED);
      await cache.put('shared-text', new Response(text));
      if (image && image.size) {
        await cache.put('shared-image', new Response(image, { headers: { 'Content-Type': image.type } }));
      } else {
        await cache.delete('shared-image');
      }
      return Response.redirect(new URL('index.html?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  // App files: network first so updates show up, cache as offline fallback.
  if (e.request.method === 'GET' && url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  }
});
