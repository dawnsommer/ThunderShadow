const CACHE_NAME = "thundershadow-github-shell-v21";
const ASSETS = [
  "./",
  "./index.html",
  "./privacy.html",
  "./css/styles.css?v=21",
  "./js/theme-init.js?v=21",
  "./js/uuid.js?v=21",
  "./js/config.js?v=21",
  "./js/reasoning.js?v=21",
  "./js/analytics.js?v=21",
  "./js/browser-api.js?v=21",
  "./js/sync.js?v=21",
  "./js/app.js?v=21",
  "./js/v3.js?v=21",
  "./js/cloud-sync.js?v=21",
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
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : undefined) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  // Code must prefer the network so installed iOS/iPadOS PWAs do not stay on
  // an obsolete merge/auth implementation after a GitHub Pages deployment.
  if (["script", "style"].includes(event.request.destination) || /\.(?:js|css|json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response && response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone())).catch(() => {});
      return response;
    }))
  );
});
