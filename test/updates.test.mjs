import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(path.join(root, "service-worker.js"), "utf8");
const release = JSON.parse(await readFile(path.join(root, "release.json"), "utf8"));
const appRoot = "https://example.test/ThunderShadow/";
const current = `${release.cachePrefix}v${release.version}`;

function worker({ fetcher = async () => { throw new Error("offline"); }, failInstall = false, instantTimeout = false } = {}) {
  const handlers = {}, records = new Map(), deleted = [], network = [], stored = [], precached = [];
  let claimed = false, skipped = false;
  const cache = {
    async match(request) { return records.get(String(request.url || request))?.clone(); },
    async put(request, response) { const key = String(request.url || request); stored.push(key); records.set(key, response); },
    async addAll(requests) {
      precached.push(...requests);
      if (failInstall) throw new Error("missing file");
      for (const file of ["./", "index.html"]) records.set(new URL(file, appRoot).href, new Response(`<meta name="thundershadow-build" content="${release.version}">`));
    }
  };
  vm.runInNewContext(source, {
    URL, Request, Response,
    setTimeout: instantTimeout ? (fn) => { queueMicrotask(fn); return 1; } : setTimeout,
    clearTimeout: instantTimeout ? () => {} : clearTimeout,
    caches: { open: async (name) => { assert.equal(name, current); return cache; }, keys: async () => [current, `${release.cachePrefix}v1`, "otherapp-v1"], delete: async (key) => { deleted.push(key); return true; } },
    fetch: async (request, options) => { network.push({ request, options }); return fetcher(request, options); },
    self: { location: { href: appRoot + "service-worker.js" }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting: async () => { skipped = true; }, clients: { claim: async () => { claimed = true; } } }
  });
  async function lifecycle(name) { const pending = []; handlers[name]({ waitUntil: (promise) => pending.push(promise) }); await Promise.all(pending); }
  function request(file, options = {}) {
    const pending = []; let response;
    handlers.fetch({ request: { url: new URL(file, appRoot).href, method: "GET", mode: "cors", destination: "script", cache: "default", ...options }, waitUntil: (promise) => pending.push(promise), respondWith: (promise) => { response = promise; } });
    return { response, pending, done: async () => { await Promise.all(pending); } };
  }
  return { records, deleted, network, stored, precached, lifecycle, request, status: () => ({ claimed, skipped }) };
}

test("install downloads the whole shell past HTTP cache; failure cannot activate", async () => {
  const good = worker(); await good.lifecycle("install");
  assert.equal(good.precached.length, release.shell.length);
  assert(good.precached.every((request) => request.cache === "reload" && request.url.startsWith(appRoot)));
  assert.equal(good.status().skipped, true);
  const bad = worker({ failInstall: true }); await assert.rejects(bad.lifecycle("install"));
  assert.equal(bad.status().skipped, false);
});

test("activation deletes only this app's obsolete caches and awaits claim", async () => {
  const w = worker(); await w.lifecycle("activate");
  assert.deepEqual(w.deleted, [`${release.cachePrefix}v1`]); assert.equal(w.status().claimed, true);
});

test("versioned assets use exact cached URLs without network or other caches", async () => {
  const w = worker(), file = `js/app.js?v=${release.version}`;
  w.records.set(appRoot + file, new Response("current code"));
  assert.equal(await (await w.request(file).response).text(), "current code");
  assert.equal(w.network.length, 0);
  assert.equal(w.request(`js/app.js?v=${release.version - 1}`).response, undefined);
  assert.equal(w.request("/otherapp/app.js?v=1").response, undefined);
  assert.equal(w.request("https://oauth.example.test/token").response, undefined);
  assert.equal(w.request("api/forms").response, undefined);
  const miss = worker(); assert.equal((await miss.request(file).response).type, "error");
});

test("offline navigation falls back to this shell even for browser reloads", async () => {
  const w = worker(); w.records.set(appRoot + "index.html", new Response("offline app"));
  const event = w.request("?return=1", { mode: "navigate", destination: "document", cache: "reload" });
  assert.equal(await (await event.response).text(), "offline app"); await event.done();
  assert.equal(w.network[0].options.cache, "no-cache");
});

test("slow late HTML and a different release never overwrite the offline shell", async () => {
  let resolveNetwork;
  const w = worker({ instantTimeout: true, fetcher: () => new Promise((resolve) => { resolveNetwork = resolve; }) });
  w.records.set(appRoot, new Response("complete offline shell"));
  const event = w.request("./", { mode: "navigate", destination: "document" });
  assert.equal(await (await event.response).text(), "complete offline shell");
  resolveNetwork(new Response(`<meta name="thundershadow-build" content="${release.version}">`, { headers: { "Content-Type": "text/html" } }));
  await event.done(); assert.deepEqual(w.stored, []);
  const mismatch = worker({ fetcher: async () => new Response('<meta name="thundershadow-build" content="999999">', { headers: { "Content-Type": "text/html" } }) });
  const mismatchEvent = mismatch.request("./", { mode: "navigate", destination: "document" });
  await mismatchEvent.response; await mismatchEvent.done(); assert.deepEqual(mismatch.stored, []);
});

test("Settings downloads bypass immutable cache without changing it", async () => {
  const w = worker({ fetcher: async () => new Response("fresh file") }), file = `js/app.js?v=${release.version}`;
  w.records.set(appRoot + file, new Response("cached file"));
  assert.equal(await (await w.request(file, { cache: "reload", destination: "" }).response).text(), "fresh file");
  assert.equal(w.network[0].options.cache, "reload"); assert.deepEqual(w.stored, []);
});

test("first install is quiet, but a later update in that same page offers Reload once", async () => {
  const listeners = {}, notices = [], registrations = [], nodes = new Map();
  const element = () => ({ addEventListener() {}, append() {}, setAttribute() {} });
  const serviceWorker = { controller: null, addEventListener: (name, fn) => { listeners[name] = fn; }, register: async (...args) => { registrations.push(args); } };
  const app = { flushPendingEntry: async (options) => { assert.equal(options.requireSaved, true); }, showToast() {} };
  nodes.set("toastRegion", { append: (notice) => notices.push(notice) });
  vm.runInNewContext(await readFile(path.join(root, "js/updates.js"), "utf8"), {
    URL, Date,
    location: { protocol: "https:" },
    navigator: { serviceWorker },
    window: { ThunderShadowApp: app },
    document: { baseURI: appRoot, readyState: "complete", addEventListener() {}, createElement: element, getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } }
  });
  assert.equal(registrations[0][0], "./service-worker.js"); assert.equal(registrations[0][1].updateViaCache, "none");
  serviceWorker.controller = {}; listeners.controllerchange(); await new Promise(setImmediate);
  assert.equal(notices.length, 0);
  listeners.controllerchange(); await new Promise(setImmediate); assert.equal(notices.length, 1);
  listeners.controllerchange(); await new Promise(setImmediate); assert.equal(notices.length, 1);
});

test("release command bumps runtime/docs together, discovers files, and check is read-only", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "thundershadow-release-test-"));
  try {
    for (const file of ["js", "css", "assets", "tools", "index.html", "privacy.html", "service-worker.js", "VERSION", "release.json", "manifest.json", "manifest.webmanifest", "README.md", "AGENTS.md"]) await cp(path.join(root, file), path.join(directory, file), { recursive: true });
    await writeFile(path.join(directory, "assets/new.svg"), "<svg/>");
    execFileSync(process.execPath, ["tools/release.mjs"], { cwd: directory });
    const next = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
    assert.equal(next.version, release.version + 1);
    assert.notEqual(next.appVersion, release.appVersion);
    assert(next.shell.includes(`./assets/new.svg?v=${next.version}`));
    for (const file of ["index.html", "privacy.html", "service-worker.js", "js/updates.js", "css/storm.css", "manifest.json", "manifest.webmanifest"]) {
      const content = await readFile(path.join(directory, file), "utf8");
      assert(!new RegExp(`\\?v=${release.version}(?!\\d)`).test(content), file);
    }
    const before = await readFile(path.join(directory, "VERSION"), "utf8");
    execFileSync(process.execPath, ["tools/release.mjs", "--check"], { cwd: directory });
    assert.equal(await readFile(path.join(directory, "VERSION"), "utf8"), before);
    await writeFile(path.join(directory, "js/new.js"), "// discovered after release\n");
    assert.throws(() => execFileSync(process.execPath, ["tools/release.mjs", "--check"], { cwd: directory, stdio: "pipe" }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
