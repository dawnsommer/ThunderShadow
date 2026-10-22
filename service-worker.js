// BEGIN GENERATED RELEASE (node tools/release.mjs)
const VERSION = 44;
const APP_VERSION = "22.0.1-deploy-refresh";
const PREFIX = "thundershadow-github-shell-";
const SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./assets/icon-180.png?v=44",
  "./assets/icon-192.png?v=44",
  "./assets/icon-512.png?v=44",
  "./assets/icon.svg?v=44",
  "./assets/lightning.svg?v=44",
  "./assets/rain-dark.svg?v=44",
  "./assets/rain-light.svg?v=44",
  "./css/storm.css?v=44",
  "./css/styles.css?v=44",
  "./js/analytics.js?v=44",
  "./js/app.js?v=44",
  "./js/browser-api.js?v=44",
  "./js/cloud-sync.js?v=44",
  "./js/config.js?v=44",
  "./js/reasoning.js?v=44",
  "./js/sync.js?v=44",
  "./js/theme-init.js?v=44",
  "./js/updates.js?v=44",
  "./js/uuid.js?v=44",
  "./js/v3.js?v=44",
  "./manifest.json?v=44",
  "./manifest.webmanifest?v=44",
  "./VERSION",
  "./release.json"
];
// END GENERATED RELEASE
const CACHE = `${PREFIX}v${VERSION}`;
const ROOT = new URL("./", self.location.href);
const SHELL_URLS = new Set(SHELL.map((file) => new URL(file, ROOT).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map((file) => new Request(new URL(file, ROOT), { cache: "reload" })));
    for (const file of ["./", "index.html"]) {
      const page = await cache.match(new URL(file, ROOT));
      if (!page || !(await page.text()).includes(`name="thundershadow-build" content="${VERSION}"`)) throw new Error("Deployment shell is incomplete.");
    }
    // Do not replace a complete offline shell until every new file is stored.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cache, event) {
  let timer, late = false;
  const network = fetch(request, { cache: "no-cache" });
  // Keep the cache write alive, but never replace the offline page with a late
  // response or an HTML release whose companion assets are not in this shell.
  event.waitUntil(network.then(async (response) => {
    if (!response.ok || late) return;
    if (response.headers.get("Content-Type")?.includes("text/html")) {
      const html = await response.clone().text();
      if (!html.includes(`name="thundershadow-build" content="${VERSION}"`)) return;
    }
    if (!late) await cache.put(request, response.clone());
  }).catch(() => {}));
  try {
    return await Promise.race([network, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("slow")), 3000); })]);
  } catch {
    late = true;
    const hit = await cache.match(request) || (request.mode === "navigate" && await cache.match(new URL("index.html", ROOT)));
    if (hit) return hit;
    try { return await network; } catch { return Response.error(); }
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // APIs, OAuth, sibling apps, and arbitrary downloads never enter our shell.
  if (!SHELL_URLS.has(url.href) && request.mode !== "navigate") return;
  event.respondWith((async () => {
    // The explicit Settings repair must bypass this worker's stored responses.
    if (request.cache === "reload" && request.destination === "") return fetch(request, { cache: "reload" });
    const cache = await caches.open(CACHE);
    if (url.searchParams.has("v")) {
      const hit = await cache.match(request);
      if (hit) return hit;
      // Never substitute another release using ignoreSearch.
      try {
        const response = await fetch(request, { cache: "no-cache" });
        if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
        return response;
      } catch { return Response.error(); }
    }
    return networkFirst(request, cache, event);
  })());
});
