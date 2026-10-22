(() => {
  "use strict";
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

  const root = new URL("./", document.baseURI);
  const workerURL = new URL("service-worker.js", root);
  const app = window.ThunderShadowApp;
  const button = document.getElementById("reloadLatestBtn");
  const status = document.getElementById("appUpdateStatus");
  document.getElementById("appVersion").textContent = `${APP_VERSION} · build ${VERSION}`;
  let repairing = false, notice = null;

  async function ownRegistration() {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration(root.href);
    // getRegistration can return a broader origin-level worker. Never remove it.
    if (registration?.scope !== root.href) return null;
    const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
    return workers.length && workers.every((worker) => worker.scriptURL === workerURL.href) ? registration : null;
  }

  async function savePending() {
    await app.flushPendingEntry({ requireSaved: true });
  }

  async function offerReload() {
    if (notice || repairing) return;
    notice = document.createElement("div");
    notice.className = "toast update-notice";
    notice.setAttribute("role", "status");
    const label = document.createElement("span");
    label.textContent = "Updated — ";
    const reload = document.createElement("button");
    reload.className = "button button--ghost";
    reload.type = "button";
    reload.textContent = "Reload";
    reload.addEventListener("click", async () => {
      reload.disabled = true;
      try { await savePending(); location.reload(); }
      catch (error) { app.showToast(error.message); reload.disabled = false; }
    });
    notice.append(label, reload);
    try { await savePending(); } catch (error) { app.showToast(error.message); }
    if (!repairing) document.getElementById("toastRegion").append(notice);
  }

  async function reloadLatest() {
    if (repairing) return;
    repairing = true;
    button.disabled = true;
    status.textContent = "Saving and downloading the latest version…";
    try {
      await savePending();
      const response = await fetch(new URL("release.json", root), { cache: "reload" });
      if (!response.ok) throw new Error("The latest version could not be downloaded. Try again when online.");
      const release = await response.json();
      if (release.cachePrefix !== PREFIX || !Number.isSafeInteger(release.version) || !Array.isArray(release.shell) || !release.shell.length) throw new Error("The release file is invalid. Try again after deployment finishes.");
      const files = [...new Set([...release.shell, "./service-worker.js"])].map((file) => {
        const url = new URL(file, root);
        if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) throw new Error("The release contains an invalid app file.");
        return url;
      });
      // Finish all downloads before removing the working offline cache.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
        while (next < files.length) {
          const file = files[next++];
          const result = await fetch(file, { cache: "reload" });
          if (!result.ok) throw new Error("Some app files could not be downloaded. Try again after deployment finishes.");
          await result.arrayBuffer();
        }
      }));
      await savePending();
      const registration = await ownRegistration();
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith(PREFIX)).map((key) => caches.delete(key)));
      }
      if (registration) await registration.unregister();
      location.reload();
    } catch (error) {
      status.textContent = error.message || "The update could not finish. Try again when online.";
      repairing = false;
      button.disabled = false;
    }
  }
  button.addEventListener("click", reloadLatest);

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    let hadController = Boolean(navigator.serviceWorker.controller);
    let lastCheck = Date.now();
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const replacing = hadController;
      hadController = Boolean(navigator.serviceWorker.controller);
      if (replacing) offerReload();
    });
    const register = () => navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || repairing || Date.now() - lastCheck < 30 * 60000) return;
      lastCheck = Date.now();
      ownRegistration().then((registration) => registration?.update()).catch(() => {});
    });
  }
})();
