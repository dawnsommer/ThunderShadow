(() => {
  "use strict";

  const SESSION_KEY = "cloudflareWorkerSession";
  const ENABLED_KEY = "thundershadow:cloud-enabled";
  const LAST_SYNC_KEY = "thundershadow:cloud-last-sync";
  const DEVICE_ID_KEY = "thundershadow:cloud-device-id";
  const DIRTY_STATE_KEY = "thundershadow:cloud-dirty-state";
  const LEGACY_DIRTY_STATE_KEY = "thundershadow:firebase-dirty-state";
  const REMOTE_INDEX_KEY = "thundershadow:drive-remote-index";
  const ACCOUNT_KEY = "thundershadow:cloud-account-email";
  const DEBUG_KEY = "thundershadow:cloud-debug";
  const SYNC_DEBOUNCE_MS = 7500;
  const FOREGROUND_CHECK_THROTTLE_MS = 60_000;
  const TOKEN_SKEW_MS = 60_000;
  const DRIVE_API = "https://www.googleapis.com/drive/v3";
  const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const MANIFEST_FORMAT_VERSION = 1;

  let accessToken = "";
  let accessTokenExpiresAt = 0;
  let accountEmail = localStorage.getItem(ACCOUNT_KEY) || "";
  let syncTimer = null;
  let syncPromise = null;
  let tokenPromise = null;
  let initialized = false;
  let listenersBound = false;
  let state = "initializing";
  let message = "Initializing Google Drive sync…";
  let lastSyncedAt = localStorage.getItem(LAST_SYNC_KEY) || null;
  let lastForegroundCheckAt = 0;
  const diagnostics = { driveReads: 0, driveWrites: 0, writesSkipped: 0, syncs: 0, tokenRefreshes: 0 };

  function cloudConfig() {
    return window.THUNDERSHADOW_CONFIG?.cloud || {};
  }

  function isConfigured() {
    const cfg = cloudConfig();
    return Boolean(cfg.appId && cfg.workerUrl && cfg.returnUrl && cfg.driveScope);
  }

  function workerUrl(path = "") {
    return `${String(cloudConfig().workerUrl || "").replace(/\/$/, "")}${path}`;
  }

  function appId() {
    return String(cloudConfig().appId || "thundershadow");
  }

  function drivePrefix() {
    return `${appId()}-`;
  }

  function getDeviceId() {
    let value = localStorage.getItem(DEVICE_ID_KEY) || "";
    if (!value) {
      value = window.ThunderShadowUUID?.() || crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, value);
    }
    return value;
  }

  function getSession() {
    return localStorage.getItem(SESSION_KEY) || "";
  }

  function setSession(value) {
    if (value) {
      localStorage.setItem(SESSION_KEY, value);
      localStorage.setItem(ENABLED_KEY, "1");
    } else {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(ENABLED_KEY);
    }
  }

  function migrateLegacyDirtyState() {
    if (localStorage.getItem(DIRTY_STATE_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_DIRTY_STATE_KEY);
    if (legacy) localStorage.setItem(DIRTY_STATE_KEY, legacy);
  }

  function blankDirtyState() {
    return { dirty: false, forms: [], entries: [], rules: [], settings: false, tombstones: false, full: false, updatedAt: null };
  }

  function getDirtyState() {
    migrateLegacyDirtyState();
    try {
      const value = JSON.parse(localStorage.getItem(DIRTY_STATE_KEY) || "null");
      return value && typeof value === "object" ? { ...blankDirtyState(), ...value } : blankDirtyState();
    } catch {
      return blankDirtyState();
    }
  }

  function clearDirtyState() {
    localStorage.setItem(DIRTY_STATE_KEY, JSON.stringify(blankDirtyState()));
    localStorage.removeItem(LEGACY_DIRTY_STATE_KEY);
  }

  function dirtyCount(value = getDirtyState()) {
    return new Set([...(value.forms || []), ...(value.entries || []), ...(value.rules || [])]).size
      + (value.settings ? 1 : 0) + (value.tombstones ? 1 : 0) + (value.full ? 1 : 0);
  }

  function debugEnabled() {
    return localStorage.getItem(DEBUG_KEY) === "1" || window.THUNDERSHADOW_CONFIG?.cloudDebug === true;
  }

  function debug(text, data = null) {
    if (!debugEnabled()) return;
    if (data == null) console.info(`[CloudSync] ${text}`);
    else console.info(`[CloudSync] ${text}`, data);
  }

  function emit() {
    const detail = getStatus();
    window.dispatchEvent(new CustomEvent("thundershadow-cloud-status", { detail }));
    updateDom(detail);
  }

  function setState(next, nextMessage) {
    state = next;
    if (nextMessage) message = nextMessage;
    emit();
  }

  function prettyTime(value) {
    if (!value) return "Never";
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
  }

  function getStatus() {
    return {
      state,
      message,
      lastSyncedAt,
      accountLabel: accountEmail,
      authorized: Boolean(getSession()),
      enabled: localStorage.getItem(ENABLED_KEY) === "1",
      deviceId: getDeviceId()
    };
  }

  function isAuthorized() {
    return Boolean(getSession());
  }

  function updateDom(detail = getStatus()) {
    const status = document.getElementById("cloudStatusText");
    const detailText = document.getElementById("cloudDetailText");
    const connect = document.getElementById("cloudConnectBtn");
    const sync = document.getElementById("cloudSyncNowBtn");
    const disconnect = document.getElementById("cloudDisconnectBtn");

    if (status) status.textContent = detail.message;
    if (detailText) {
      const account = detail.accountLabel ? ` Connected as ${detail.accountLabel}.` : "";
      detailText.textContent = detail.authorized
        ? `Last successful Drive sync: ${prettyTime(detail.lastSyncedAt)}.${account} IndexedDB remains the local source of truth.`
        : "Progress remains stored in this browser. Connect Google once to enable private Drive app-data synchronization.";
    }
    if (connect) {
      connect.textContent = detail.authorized ? "Google connected" : "Connect Google";
      connect.disabled = detail.authorized || ["connecting", "syncing", "initializing"].includes(detail.state);
    }
    if (sync) sync.disabled = !detail.authorized || ["connecting", "syncing", "initializing"].includes(detail.state);
    if (disconnect) disconnect.disabled = !detail.authorized;
  }

  function consumeOAuthCallback() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return false;
    const params = new URLSearchParams(raw);
    const session = params.get("cloud-auth") || "";
    if (!session) return false;

    // Store the Worker session, then remove it from the address bar immediately.
    // Never log or export this value.
    setSession(session);
    params.delete("cloud-auth");
    const remainingHash = params.toString();
    history.replaceState(null, document.title, `${location.pathname}${location.search}${remainingHash ? `#${remainingHash}` : ""}`);
    return true;
  }

  function connect() {
    if (!isConfigured()) throw new Error("Cloud sync is not configured.");
    if (getSession()) return syncNow({ background: false, reason: "connect-existing-session" });
    const params = new URLSearchParams({
      app_id: appId(),
      return_url: String(cloudConfig().returnUrl),
      device_id: getDeviceId()
    });
    localStorage.setItem(ENABLED_KEY, "1");
    setState("connecting", "Opening Google authorization…");
    location.assign(`${workerUrl("/oauth/start")}?${params.toString()}`);
    return null;
  }

  function normalizeExpiry(payload = {}) {
    const absolute = payload.expires_at ?? payload.expiresAt ?? payload.expiry ?? payload.expiry_time ?? payload.expiryTime;
    if (absolute != null) {
      if (typeof absolute === "number") return absolute > 10_000_000_000 ? absolute : absolute * 1000;
      const parsed = Date.parse(String(absolute));
      if (Number.isFinite(parsed)) return parsed;
    }
    const seconds = Number(payload.expires_in ?? payload.expiresIn ?? 3600);
    return Date.now() + Math.max(60, Number.isFinite(seconds) ? seconds : 3600) * 1000;
  }

  function accessTokenFromPayload(payload = {}) {
    return String(payload.access_token || payload.accessToken || payload.google_access_token || payload.googleAccessToken || payload.token || "");
  }

  function accountFromPayload(payload = {}) {
    return String(payload.email || payload.account_email || payload.accountEmail || payload.account?.email || "");
  }

  async function getValidDriveAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && accessToken && accessTokenExpiresAt > Date.now() + TOKEN_SKEW_MS) return accessToken;
    if (tokenPromise) return tokenPromise;
    const session = getSession();
    if (!session) throw new Error("Google is not connected.");
    if (!navigator.onLine) throw new Error("Offline");

    tokenPromise = (async () => {
      diagnostics.tokenRefreshes += 1;
      const response = await fetch(workerUrl("/token"), {
        method: "POST",
        headers: { Authorization: `Bearer ${session}`, Accept: "application/json" },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          setSession("");
          accessToken = "";
          accessTokenExpiresAt = 0;
          accountEmail = "";
          localStorage.removeItem(ACCOUNT_KEY);
          setState("signedout", "Google connection expired. Local data remains safe; connect Google again to resume cloud sync.");
        }
        throw new Error(payload?.error?.message || payload?.message || `Token refresh failed (${response.status}).`);
      }
      const token = accessTokenFromPayload(payload);
      if (!token) throw new Error("Worker token response did not contain a Google access token.");
      accessToken = token;
      accessTokenExpiresAt = normalizeExpiry(payload);
      const email = accountFromPayload(payload);
      if (email) {
        accountEmail = email;
        localStorage.setItem(ACCOUNT_KEY, email);
      }
      return accessToken;
    })().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  async function driveFetch(url, options = {}, { retryAuth = true, read = false, write = false } = {}) {
    const token = await getValidDriveAccessToken();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers, cache: "no-store" });
    if (response.status === 401 && retryAuth) {
      accessToken = "";
      accessTokenExpiresAt = 0;
      await getValidDriveAccessToken({ forceRefresh: true });
      return driveFetch(url, options, { retryAuth: false, read, write });
    }
    if (read) diagnostics.driveReads += 1;
    if (write) diagnostics.driveWrites += 1;
    return response;
  }

  function namespaceFile(file) {
    return file?.appProperties?.appId === appId() || String(file?.name || "").startsWith(drivePrefix());
  }

  async function listNamespaceFiles() {
    const files = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        spaces: "appDataFolder",
        q: "trashed = false",
        pageSize: "1000",
        fields: "nextPageToken,files(id,name,modifiedTime,size,md5Checksum,appProperties)"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await driveFetch(`${DRIVE_API}/files?${params.toString()}`, {}, { read: true });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || `Drive file list failed (${response.status}).`);
      for (const file of payload.files || []) if (namespaceFile(file)) files.push(file);
      pageToken = payload.nextPageToken || "";
    } while (pageToken);
    return files;
  }

  function fileMap(files) {
    return new Map((files || []).map((file) => [file.name, file]));
  }

  async function readJsonFile(file) {
    if (!file?.id) return null;
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`, {}, { read: true });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || `Drive download failed (${response.status}).`);
    }
    return response.json();
  }

  function makeMultipartBody(metadata, jsonText, boundary) {
    return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${jsonText}\r\n--${boundary}--`;
  }

  async function createJsonFile(name, kind, key, value) {
    const boundary = `thundershadow-${crypto.randomUUID()}`;
    const metadata = {
      name,
      parents: ["appDataFolder"],
      mimeType: "application/json",
      appProperties: { appId: appId(), kind, key: String(key || ""), formatVersion: String(MANIFEST_FORMAT_VERSION) }
    };
    const jsonText = JSON.stringify(value);
    const response = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime,md5Checksum,appProperties`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: makeMultipartBody(metadata, jsonText, boundary)
    }, { write: true });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `Drive upload failed (${response.status}).`);
    return payload;
  }

  async function updateJsonFile(file, value) {
    const response = await driveFetch(`${DRIVE_UPLOAD_API}/files/${encodeURIComponent(file.id)}?uploadType=media&fields=id,name,modifiedTime,md5Checksum,appProperties`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(value)
    }, { write: true });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `Drive update failed (${response.status}).`);
    return payload;
  }

  async function writeJsonFile(existingFile, name, kind, key, value) {
    return existingFile ? updateJsonFile(existingFile, value) : createJsonFile(name, kind, key, value);
  }

  async function deleteDriveFile(file) {
    if (!file?.id) return false;
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`, { method: "DELETE" }, { write: true });
    if (!response.ok && response.status !== 404) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || `Drive delete failed (${response.status}).`);
    }
    return true;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function encodeKey(value) {
    return bytesToBase64Url(new TextEncoder().encode(String(value)));
  }

  function formFileName(id) { return `${drivePrefix()}form-${encodeKey(id)}.json`; }
  function ruleFileName(id) { return `${drivePrefix()}rule-${encodeKey(id)}.json`; }
  function settingsFileName() { return `${drivePrefix()}settings.json`; }
  function manifestFileName() { return `${drivePrefix()}manifest.json`; }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }

  async function hashJson(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return bytesToBase64Url(digest);
  }

  function blankManifest() {
    return {
      app: "ThunderShadow",
      appId: appId(),
      formatVersion: MANIFEST_FORMAT_VERSION,
      schemaVersion: 1,
      updatedAt: "",
      lastModifiedBy: "",
      forms: {},
      rules: {},
      settings: null,
      tombstones: { forms: {}, rules: {}, entries: {} }
    };
  }

  function validManifest(value) {
    if (!value || typeof value !== "object") return blankManifest();
    return {
      ...blankManifest(),
      ...value,
      forms: value.forms && typeof value.forms === "object" ? value.forms : {},
      rules: value.rules && typeof value.rules === "object" ? value.rules : {},
      settings: value.settings && typeof value.settings === "object" ? value.settings : null,
      tombstones: {
        forms: { ...(value.tombstones?.forms || {}) },
        rules: { ...(value.tombstones?.rules || {}) },
        entries: { ...(value.tombstones?.entries || {}) }
      }
    };
  }

  function readRemoteIndex() {
    try {
      const parsed = JSON.parse(localStorage.getItem(REMOTE_INDEX_KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed : { files: {}, checkedAt: null };
    } catch {
      return { files: {}, checkedAt: null };
    }
  }

  function remoteIndexFor(files) {
    const output = {};
    for (const file of files || []) output[file.name] = `${file.id}:${file.modifiedTime || ""}:${file.md5Checksum || ""}`;
    return { files: output, checkedAt: new Date().toISOString() };
  }

  function sameRemoteIndex(a, b) {
    return JSON.stringify(stableValue(a?.files || {})) === JSON.stringify(stableValue(b?.files || {}));
  }

  function saveRemoteIndex(files) {
    localStorage.setItem(REMOTE_INDEX_KEY, JSON.stringify(remoteIndexFor(files)));
  }

  async function buildRemoteDelta(files) {
    const byName = fileMap(files);
    const priorIndex = readRemoteIndex();
    const currentIndex = remoteIndexFor(files);
    const firstSync = !Object.keys(priorIndex.files || {}).length;
    const manifestFile = byName.get(manifestFileName());
    let manifest = blankManifest();
    if (manifestFile) manifest = validManifest(await readJsonFile(manifestFile));

    const forms = [];
    const rules = [];
    let settings = {};
    let settingsUpdatedAt = "";

    const shouldFetch = (file) => firstSync || priorIndex.files?.[file.name] !== currentIndex.files?.[file.name];
    for (const file of files) {
      const kind = file.appProperties?.kind || "";
      if (kind === "form" && shouldFetch(file)) {
        const value = await readJsonFile(file);
        if (value?.data?.id) forms.push(value.data);
        else if (value?.id) forms.push(value);
      } else if (kind === "rule" && shouldFetch(file)) {
        const value = await readJsonFile(file);
        if (value?.data?.id) rules.push(value.data);
        else if (value?.id) rules.push(value);
      }
    }

    const settingsFile = byName.get(settingsFileName());
    if (settingsFile && shouldFetch(settingsFile)) {
      const value = await readJsonFile(settingsFile);
      settings = value?.settings || value?.data || {};
      settingsUpdatedAt = value?.updatedAt || "";
    }

    return {
      exists: files.length > 0,
      manifest,
      byName,
      deltaPayload: {
        app: "ThunderShadow",
        version: 6,
        storage: "google-drive-appdata",
        exportedAt: manifest.updatedAt || new Date().toISOString(),
        schemaVersion: Number(manifest.schemaVersion || 1),
        forms,
        rules,
        settings,
        settingsUpdatedAt,
        tombstones: manifest.tombstones
      },
      currentIndex,
      firstSync
    };
  }

  function mergeTombstones(target, source) {
    const result = {
      forms: { ...(target?.forms || {}) },
      rules: { ...(target?.rules || {}) },
      entries: { ...(target?.entries || {}) }
    };
    for (const bucket of ["forms", "rules", "entries"]) {
      for (const [id, timestamp] of Object.entries(source?.[bucket] || {})) {
        if (!result[bucket][id] || result[bucket][id] < timestamp) result[bucket][id] = timestamp;
      }
    }
    return result;
  }

  async function writeLocalDeltaToDrive(payload, remote, dirtyAtStart) {
    const byName = remote.byName;
    const manifest = validManifest(remote.manifest);
    const nextManifest = validManifest(manifest);
    const localForms = new Map((payload.forms || []).map((form) => [String(form.id), form]));
    const localRules = new Map((payload.rules || []).map((rule) => [String(rule.id), rule]));
    const dirtyForms = new Set((dirtyAtStart.forms || []).map(String));
    const dirtyRules = new Set((dirtyAtStart.rules || []).map(String));

    for (const entryKey of dirtyAtStart.entries || []) {
      const text = String(entryKey);
      const colon = text.lastIndexOf(":");
      if (colon > 0) dirtyForms.add(text.slice(0, colon));
    }

    // A full dirty state is used after database restore/initial Drive seeding.
    if (dirtyAtStart.full || !remote.exists) {
      for (const id of localForms.keys()) dirtyForms.add(id);
      for (const id of localRules.keys()) dirtyRules.add(id);
    }

    let changed = false;
    let fileWrites = 0;

    for (const id of dirtyForms) {
      const form = localForms.get(id);
      const name = formFileName(id);
      const existing = byName.get(name);
      if (!form) {
        if (existing) { await deleteDriveFile(existing); byName.delete(name); fileWrites += 1; changed = true; }
        delete nextManifest.forms[id];
        continue;
      }
      const value = { app: "ThunderShadow", appId: appId(), kind: "form", id, data: form };
      const hash = await hashJson(value);
      if (nextManifest.forms[id]?.hash === hash && existing) {
        diagnostics.writesSkipped += 1;
        debug(`skip form/${id} unchanged`);
        continue;
      }
      const saved = await writeJsonFile(existing, name, "form", id, value);
      byName.set(name, { ...existing, ...saved, name });
      nextManifest.forms[id] = { name, hash, updatedAt: String(form.updatedAt || "") };
      fileWrites += 1;
      changed = true;
      debug(`write form/${id}`);
    }

    for (const id of dirtyRules) {
      const rule = localRules.get(id);
      const name = ruleFileName(id);
      const existing = byName.get(name);
      if (!rule) {
        if (existing) { await deleteDriveFile(existing); byName.delete(name); fileWrites += 1; changed = true; }
        delete nextManifest.rules[id];
        continue;
      }
      const value = { app: "ThunderShadow", appId: appId(), kind: "rule", id, data: rule };
      const hash = await hashJson(value);
      if (nextManifest.rules[id]?.hash === hash && existing) {
        diagnostics.writesSkipped += 1;
        debug(`skip rule/${id} unchanged`);
        continue;
      }
      const saved = await writeJsonFile(existing, name, "rule", id, value);
      byName.set(name, { ...existing, ...saved, name });
      nextManifest.rules[id] = { name, hash, updatedAt: String(rule.updatedAt || "") };
      fileWrites += 1;
      changed = true;
      debug(`write rule/${id}`);
    }

    if (dirtyAtStart.settings || dirtyAtStart.full || !remote.exists) {
      const name = settingsFileName();
      const existing = byName.get(name);
      const value = {
        app: "ThunderShadow",
        appId: appId(),
        kind: "settings",
        updatedAt: payload.settingsUpdatedAt || new Date().toISOString(),
        settings: payload.settings || {}
      };
      const hash = await hashJson(value.settings);
      if (nextManifest.settings?.hash === hash && existing) {
        diagnostics.writesSkipped += 1;
        debug("skip settings unchanged");
      } else {
        const saved = await writeJsonFile(existing, name, "settings", "settings", value);
        byName.set(name, { ...existing, ...saved, name });
        nextManifest.settings = { name, hash, updatedAt: value.updatedAt };
        fileWrites += 1;
        changed = true;
        debug("write settings");
      }
    }

    const mergedTombstones = mergeTombstones(nextManifest.tombstones, payload.tombstones);
    if (JSON.stringify(stableValue(mergedTombstones)) !== JSON.stringify(stableValue(nextManifest.tombstones))) {
      nextManifest.tombstones = mergedTombstones;
      changed = true;
    }

    // Remove files whose local object is tombstoned. The tombstone remains in the manifest
    // so another device cannot resurrect the deleted object.
    if (dirtyAtStart.tombstones || dirtyAtStart.full) {
      for (const id of Object.keys(nextManifest.tombstones.forms || {})) {
        if (localForms.has(id)) continue;
        const name = nextManifest.forms[id]?.name || formFileName(id);
        const existing = byName.get(name);
        if (existing) { await deleteDriveFile(existing); byName.delete(name); fileWrites += 1; changed = true; }
        delete nextManifest.forms[id];
      }
      for (const id of Object.keys(nextManifest.tombstones.rules || {})) {
        if (localRules.has(id)) continue;
        const name = nextManifest.rules[id]?.name || ruleFileName(id);
        const existing = byName.get(name);
        if (existing) { await deleteDriveFile(existing); byName.delete(name); fileWrites += 1; changed = true; }
        delete nextManifest.rules[id];
      }
    }

    if (changed) {
      nextManifest.app = "ThunderShadow";
      nextManifest.appId = appId();
      nextManifest.formatVersion = MANIFEST_FORMAT_VERSION;
      nextManifest.schemaVersion = Number(payload.schemaVersion || 1);
      nextManifest.updatedAt = new Date().toISOString();
      nextManifest.lastModifiedBy = getDeviceId();
      const manifestName = manifestFileName();
      const existing = byName.get(manifestName);
      const saved = await writeJsonFile(existing, manifestName, "manifest", "manifest", nextManifest);
      byName.set(manifestName, { ...existing, ...saved, name: manifestName });
      fileWrites += 1;
      debug("write manifest");
    } else {
      diagnostics.writesSkipped += 1;
      debug("skip manifest unchanged");
    }

    return { changed, fileWrites, manifest: nextManifest };
  }

  async function syncNow({ background = false, reason = "manual" } = {}) {
    if (!getSession()) {
      if (!background) return connect();
      setState("signedout", "Progress is saved locally. Connect Google to enable Drive sync.");
      throw new Error("Google is not connected.");
    }
    if (!navigator.onLine) {
      setState("offline", "Offline — changes are saved locally and will sync when internet returns.");
      throw new Error("Offline");
    }
    if (syncPromise) return syncPromise;

    const dirtyAtStart = getDirtyState();
    const beforeReads = diagnostics.driveReads;
    const beforeWrites = diagnostics.driveWrites;
    const beforeSkipped = diagnostics.writesSkipped;
    diagnostics.syncs += 1;
    debug(`trigger=${reason} dirty=${dirtyCount(dirtyAtStart)}`);

    syncPromise = (async () => {
      setState("syncing", background ? "Synchronizing pending changes with Google Drive…" : "Synchronizing browser data with Google Drive…");
      await getValidDriveAccessToken();
      const filesBefore = await listNamespaceFiles();
      const remote = await buildRemoteDelta(filesBefore);

      // Remote data is applied through BrowserApi.mergePackage, which writes directly to
      // IndexedDB and deliberately does not emit a local mutation event. This prevents echo loops.
      let merged = remote.exists
        ? await window.ThunderShadowBrowserApi.mergePackage(remote.deltaPayload)
        : await window.ThunderShadowBrowserApi.exportPackage();

      // If remote data changed while this device was clean, only write back when the merge
      // actually needs a local correction. We detect that by marking the fetched remote records.
      const effectiveDirty = { ...dirtyAtStart, forms: [...(dirtyAtStart.forms || [])], rules: [...(dirtyAtStart.rules || [])] };
      if (!dirtyAtStart.dirty && remote.exists) {
        for (const form of remote.deltaPayload.forms || []) effectiveDirty.forms.push(String(form.id));
        for (const rule of remote.deltaPayload.rules || []) effectiveDirty.rules.push(String(rule.id));
        if (remote.deltaPayload.settingsUpdatedAt) effectiveDirty.settings = true;
      }

      const result = await writeLocalDeltaToDrive(merged, remote, effectiveDirty);
      const filesAfter = result.changed ? await listNamespaceFiles() : filesBefore;
      saveRemoteIndex(filesAfter);

      const dirtyAfterSync = getDirtyState();
      if (!dirtyAfterSync.dirty || dirtyAfterSync.updatedAt === dirtyAtStart.updatedAt) clearDirtyState();
      else scheduleSync({ reason: "edit-during-sync" });

      lastSyncedAt = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, lastSyncedAt);
      setState("synced", result.fileWrites ? "Google Drive synchronization complete." : "Synced — no cloud changes were needed.");
      window.dispatchEvent(new CustomEvent("thundershadow-cloud-merged", { detail: { reason, writes: result.fileWrites } }));
      debug(`complete reason=${reason} reads=${diagnostics.driveReads - beforeReads} writes=${diagnostics.driveWrites - beforeWrites} skipped=${diagnostics.writesSkipped - beforeSkipped}`);
      return merged;
    })().catch((error) => {
      if (!navigator.onLine || error?.message === "Offline") {
        setState("offline", "Offline — changes are saved locally and will sync when internet returns.");
      } else if (getSession()) {
        setState("error", `Cloud unavailable — local data is safe. ${error?.message || error}`);
      }
      throw error;
    }).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function remoteChanged() {
    if (!getSession() || !navigator.onLine) return false;
    const files = await listNamespaceFiles();
    const current = remoteIndexFor(files);
    return !sameRemoteIndex(readRemoteIndex(), current);
  }

  async function startupSyncCheck() {
    if (!getSession()) {
      setState("signedout", "Progress is saved locally. Connect Google to enable Drive sync.");
      return;
    }
    if (!navigator.onLine) {
      setState("offline", "Offline — ThunderShadow is using IndexedDB. Pending cloud changes will resume later.");
      return;
    }
    try {
      await getValidDriveAccessToken();
      setState("ready", accountEmail ? `Google Drive sync ready for ${accountEmail}.` : "Google Drive sync ready.");
      await syncNow({ background: true, reason: getDirtyState().dirty ? "startup-dirty" : "startup-check" });
    } catch (error) {
      if (getSession()) setState("error", `Cloud unavailable — local data is safe. ${error?.message || error}`);
    }
  }

  function scheduleSync({ reason = "local-edit", immediate = false } = {}) {
    clearTimeout(syncTimer);
    if (!getSession()) return;
    const run = () => {
      syncTimer = null;
      if (navigator.onLine && getDirtyState().dirty) syncNow({ background: true, reason }).catch(() => {});
    };
    if (immediate) run();
    else syncTimer = setTimeout(run, SYNC_DEBOUNCE_MS);
  }

  async function handleForeground() {
    if (!getSession() || !navigator.onLine) return;
    if (getDirtyState().dirty) {
      scheduleSync({ reason: "foreground-dirty", immediate: true });
      return;
    }
    if (Date.now() - lastForegroundCheckAt < FOREGROUND_CHECK_THROTTLE_MS) return;
    lastForegroundCheckAt = Date.now();
    try {
      if (await remoteChanged()) await syncNow({ background: true, reason: "foreground-remote-change" });
    } catch {
      // Foreground checks are opportunistic; IndexedDB remains usable.
    }
  }

  function handleLocalMutation(event) {
    const detail = event?.detail || {};
    scheduleSync({ reason: detail.kind || "local-edit", immediate: Boolean(detail.immediate) });
  }

  async function disconnect() {
    const session = getSession();
    let remoteError = null;
    if (session && navigator.onLine) {
      try {
        const response = await fetch(workerUrl("/disconnect"), {
          method: "POST",
          headers: { Authorization: `Bearer ${session}`, Accept: "application/json" },
          cache: "no-store"
        });
        if (!response.ok) remoteError = new Error(`Worker disconnect failed (${response.status}).`);
      } catch (error) {
        remoteError = error;
      }
    }

    clearTimeout(syncTimer);
    syncTimer = null;
    setSession("");
    accessToken = "";
    accessTokenExpiresAt = 0;
    accountEmail = "";
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(REMOTE_INDEX_KEY);
    setState("signedout", remoteError
      ? "Google disconnected locally. The Worker could not be reached; local ThunderShadow data was not changed."
      : "Google disconnected. ThunderShadow data remains stored locally and Drive files were left intact.");
    return { disconnected: true, workerReached: !remoteError };
  }

  function getDiagnostics() {
    return { ...diagnostics, dirty: getDirtyState(), debounceMs: SYNC_DEBOUNCE_MS };
  }

  function bindDom() {
    document.getElementById("cloudConnectBtn")?.addEventListener("click", () => Promise.resolve(connect()).catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
    document.getElementById("cloudSyncNowBtn")?.addEventListener("click", () => syncNow({ background: false, reason: "manual-sync" }).catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
    document.getElementById("cloudDisconnectBtn")?.addEventListener("click", () => disconnect().catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    addEventListener("thundershadow-local-data-changed", handleLocalMutation);
    addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") handleForeground(); });
    addEventListener("pageshow", () => handleForeground());
    addEventListener("focus", () => handleForeground());
    addEventListener("online", () => {
      if (!getSession()) return;
      if (getDirtyState().dirty) scheduleSync({ reason: "online-dirty", immediate: true });
      else syncNow({ background: true, reason: "online-check" }).catch(() => {});
    });
    addEventListener("offline", () => {
      if (getSession()) setState("offline", "Offline — changes are saved locally and will sync when internet returns.");
    });
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    migrateLegacyDirtyState();
    consumeOAuthCallback();
    bindDom();
    bindListeners();

    if (!isConfigured()) {
      setState("unconfigured", "Cloud sync is not configured. IndexedDB remains active.");
      return;
    }
    if (!getSession()) {
      setState("signedout", "Progress is saved locally. Connect Google to enable Drive sync.");
      return;
    }
    setState("connecting", "Restoring Google Drive connection…");
    startupSyncCheck();
  }

  window.ThunderShadowCloud = {
    initialize,
    connect,
    disconnect,
    syncNow,
    scheduleSync,
    getValidDriveAccessToken,
    getStatus,
    getDirtyState,
    isAuthorized,
    getDiagnostics,
    getDeviceId
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
