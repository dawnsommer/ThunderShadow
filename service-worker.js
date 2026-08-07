const CACHE_NAME = "thundershadow-github-shell-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./privacy.html",
  "./css/styles.css",
  "./js/theme-init.js",
  "./js/uuid.js",
  "./js/config.js",
  "./js/reasoning.js",
  "./js/analytics.js",
  "./js/browser-api.js",
  "./js/sync.js",
  "./js/app.js",
  "./js/v3.js",
  "./js/drive-sync.js",
  "./manifest.json",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      return response;
    }).catch(async () => {
      const exact = await caches.match(event.request);
      return exact || caches.match("./index.html");
    }));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
    return response;
  })));
});
