const CACHE_NAME = "grocery-list-offline-v1pt1";

const APP_FILES = [
  "/tools/jimarsagun-grocery-list.html",
  "/tools/tools-assets/jimarsagun-grocery.js",
  "/assets/style.css",
  "/assets/gdlcfavicon2.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_FILES)
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  if (url.pathname === "/tools/jimarsagun-grocery-list.html") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(request, copy)
            );
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || Response.error();
        })
    );
    return;
  }

  if (APP_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request);
      })
    );
  }
});
