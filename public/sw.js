const CACHE_NAME = "meshakhei-yeladut-v1";

const PRECACHE_URLS = [
  "/",
  "/home.css",
  "/manifest.json",
  "/icon.svg",
  "/pwa-register.js",
  "/shared/player-name.js",
  "/sentence-game/",
  "/sentence-game/styles.css",
  "/sentence-game/app.js",
  "/rps/",
  "/rps/styles.css",
  "/rps/app.js",
  "/aretz-ir/",
  "/aretz-ir/styles.css",
  "/aretz-ir/app.js",
  "/xo/",
  "/xo/styles.css",
  "/xo/app.js",
  "/taki/",
  "/taki/styles.css",
  "/taki/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(function () {
              return undefined;
            })
          )
        )
      )
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => {
            if (k !== CACHE_NAME) return caches.delete(k);
            return undefined;
          })
        )
      )
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/socket.io")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            try {
              cache.put(req, copy);
            } catch (_e) {
              /* ignore */
            }
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then((hit) => {
          if (hit) return hit;
          if (req.mode === "navigate") {
            return caches.match("/");
          }
          return Promise.reject();
        });
      })
  );
});
