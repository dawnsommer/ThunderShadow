(() => {
  "use strict";

  const FIREBASE_VERSION = "12.16.0";
  const ENABLED_KEY = "thundershadow:firebase-enabled";
  const LAST_SYNC_KEY = "thundershadow:firebase-last-sync";
  const DEVICE_ID_KEY = "thundershadow:firebase-device-id";
  const REDIRECT_STATE_KEY = "thundershadow:firebase-google-redirect-state";
  const DIRTY_STATE_KEY = "thundershadow:firebase-dirty-state";
  const REMOTE_META_KEY = "thundershadow:firebase-remote-meta";
  const DEBUG_KEY = "thundershadow:firebase-debug";
  const SYNC_DEBOUNCE_MS = 7500;

  let sdk = null;
  let firebaseApp = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let syncTimer = null;
  let syncPromise = null;
  let connectPromise = null;
  let state = "initializing";
  let message = "Initializing Firebase…";
  let lastSyncedAt = localStorage.getItem(LAST_SYNC_KEY) || null;
  let deviceId = localStorage.getItem(DEVICE_ID_KEY) || "";
  let initialized = false;
  let listenersBound = false;
  let startupCheckedUid = "";
  let remoteCheckPromise = null;
  let lastRemoteCheckAt = 0;
  const diagnostics = { reads: 0, writesAttempted: 0, writesSkipped: 0, syncs: 0 };

  if (!deviceId) {
    deviceId = window.ThunderShadowUUID?.() || crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  function config() {
    return window.THUNDERSHADOW_CONFIG?.firebase || {};
  }

  function isConfigured() {
    const value = config();
    return Boolean(value.apiKey && value.projectId && value.appId && !String(value.apiKey).includes("YOUR_FIREBASE"));
  }

  function googleWebClientId() {
    return String(window.THUNDERSHADOW_CONFIG?.googleClientId || "").trim();
  }

  function isStandalonePwa() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true || window.navigator.standalone === true;
  }

  function isAppleMobile() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function emit() {
    const detail = getStatus();
    window.dispatchEvent(new CustomEvent("thundershadow-firebase-status", { detail }));
    updateDom(detail);
  }

  function setState(next, nextMessage) {
    state = next;
    if (nextMessage) message = nextMessage;
    emit();
  }

  function getStatus() {
    return {
      state,
      message,
      lastSyncedAt,
      accountLabel: currentUser?.email || "",
      authorized: Boolean(currentUser),
      enabled: localStorage.getItem(ENABLED_KEY) === "1",
      uid: currentUser?.uid || ""
    };
  }

  function isAuthorized() {
    return Boolean(currentUser);
  }

  function prettyTime(value) {
    if (!value) return "Never";
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
  }

  function updateDom(detail = getStatus()) {
    const status = document.getElementById("firebaseStatusText");
    const detailText = document.getElementById("firebaseDetailText");
    const connect = document.getElementById("firebaseConnectBtn");
    const sync = document.getElementById("firebaseSyncNowBtn");
    const disconnect = document.getElementById("firebaseDisconnectBtn");

    if (status) status.textContent = detail.message;
    if (detailText) {
      const account = detail.accountLabel ? ` Signed in as ${detail.accountLabel}.` : "";
      detailText.textContent = detail.authorized
        ? `Last successful cloud sync: ${prettyTime(detail.lastSyncedAt)}.${account} IndexedDB remains the local source of truth.`
        : "Progress remains stored in this browser. Sign in once to synchronize it privately across your ThunderShadow devices.";
    }
    if (connect) {
      connect.textContent = detail.authorized ? "Signed in" : "Sign in with Google";
      connect.disabled = detail.authorized || ["connecting", "syncing", "initializing"].includes(detail.state);
    }
    if (sync) sync.disabled = !detail.authorized || ["connecting", "syncing", "initializing"].includes(detail.state);
    if (disconnect) disconnect.disabled = !detail.authorized;
  }

  async function loadSdk() {
    if (sdk) return sdk;
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appSdk, authSdk, fireSdk] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`)
    ]);
    sdk = { ...appSdk, ...authSdk, ...fireSdk };
    return sdk;
  }

  async function initFirebase() {
    if (!isConfigured()) {
      setState("unconfigured", "Firebase is not configured yet. Add your Firebase Web App config in js/config.js.");
      return false;
    }

    await loadSdk();
    firebaseApp = sdk.initializeApp(config());
    auth = sdk.getAuth(firebaseApp);
    try {
      await sdk.setPersistence(auth, sdk.indexedDBLocalPersistence);
    } catch {
      await sdk.setPersistence(auth, sdk.browserLocalPersistence).catch(() => {});
    }
    db = sdk.getFirestore(firebaseApp);

    sdk.onAuthStateChanged(auth, (user) => {
      currentUser = user || null;
      if (currentUser) {
        localStorage.setItem(ENABLED_KEY, "1");
        setState("ready", `Cloud sync ready for ${currentUser.email || "this Google account"}.`);
        if (startupCheckedUid !== currentUser.uid) {
          startupCheckedUid = currentUser.uid;
          setTimeout(() => startupSyncCheck().catch(() => {}), 700);
        }
      } else {
        startupCheckedUid = "";
        setState("signedout", "Progress is saved locally. Sign in with Google to enable Firebase cloud sync.");
      }
    });
    return true;
  }

  function oauthRedirectUri() {
    const url = new URL("./", location.href);
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function randomState() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function beginDirectGoogleRedirect() {
    const clientId = googleWebClientId();
    if (!clientId || clientId.includes("YOUR_THUNDERSHADOW_PUBLIC_OAUTH_CLIENT_ID")) {
      throw new Error("The Google Web OAuth Client ID is not configured in js/config.js for iPhone/iPad PWA sign-in.");
    }
    const stateValue = randomState();
    sessionStorage.setItem(REDIRECT_STATE_KEY, stateValue);
    localStorage.setItem(ENABLED_KEY, "1");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: oauthRedirectUri(),
      response_type: "token",
      scope: "openid email profile",
      state: stateValue,
      include_granted_scopes: "true",
      prompt: "select_account"
    });
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }

  async function consumeDirectGoogleRedirect() {
    if (!location.hash.includes("access_token=") && !location.hash.includes("error=")) return false;
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    const expected = sessionStorage.getItem(REDIRECT_STATE_KEY) || "";
    const returned = fragment.get("state") || "";
    sessionStorage.removeItem(REDIRECT_STATE_KEY);
    history.replaceState(null, document.title, `${location.pathname}${location.search}`);

    if (!expected || expected !== returned) {
      setState("error", "Google sign-in could not be verified. Local browser data is safe.");
      return true;
    }
    if (fragment.has("error")) {
      setState("signedout", `${fragment.get("error_description") || fragment.get("error")}. Local browser data is safe.`);
      return true;
    }
    const token = fragment.get("access_token") || "";
    if (!token) {
      setState("signedout", "Google sign-in returned without a token. Local browser data is safe.");
      return true;
    }

    const credential = sdk.GoogleAuthProvider.credential(null, token);
    setState("connecting", "Google account accepted. Creating persistent Firebase session…");
    await sdk.signInWithCredential(auth, credential);
    return true;
  }

  async function connect() {
    if (connectPromise) return connectPromise;
    connectPromise = (async () => {
      if (!auth && !(await initFirebase())) throw new Error("Firebase is not configured.");
      if (currentUser) return syncNow({ background: false });
      localStorage.setItem(ENABLED_KEY, "1");

      if (isStandalonePwa() && isAppleMobile()) {
        beginDirectGoogleRedirect();
        return null;
      }

      setState("connecting", "Opening Google sign-in…");
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const result = await sdk.signInWithPopup(auth, provider);
        currentUser = result.user;
        setState("ready", `Signed in as ${currentUser.email || "Google user"}. Synchronizing…`);
        return syncNow({ background: false });
      } catch (error) {
        if (["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
          beginDirectGoogleRedirect();
          return null;
        }
        setState("signedout", `Google sign-in failed: ${error?.message || error}. Local browser data is safe.`);
        throw error;
      }
    })().finally(() => { connectPromise = null; });
    return connectPromise;
  }

  function userPath(...parts) {
    if (!currentUser?.uid) throw new Error("Firebase user is not signed in.");
    return ["users", currentUser.uid, ...parts];
  }

  function encodeDocId(value) {
    const bytes = new TextEncoder().encode(String(value));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }


  function firestoreSafe(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => firestoreSafe(item)).filter((item) => item !== undefined);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const safe = firestoreSafe(item);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  }

  function stripFormEntries(form) {
    const value = structuredClone(form || {});
    delete value.entries;
    delete value.questions;
    return value;
  }

  function debugEnabled() {
    return localStorage.getItem(DEBUG_KEY) === "1" || window.THUNDERSHADOW_CONFIG?.firebaseDebug === true;
  }

  function debug(message, extra = null) {
    if (!debugEnabled()) return;
    if (extra == null) console.info(`[CloudSync] ${message}`);
    else console.info(`[CloudSync] ${message}`, extra);
  }

  function blankDirtyState() {
    return { dirty: false, forms: [], entries: [], rules: [], settings: false, tombstones: false, full: false, updatedAt: null };
  }

  function getDirtyState() {
    try {
      const value = JSON.parse(localStorage.getItem(DIRTY_STATE_KEY) || "null");
      return value && typeof value === "object" ? { ...blankDirtyState(), ...value } : blankDirtyState();
    } catch { return blankDirtyState(); }
  }

  function clearDirtyState() {
    localStorage.setItem(DIRTY_STATE_KEY, JSON.stringify(blankDirtyState()));
  }

  function dirtyCount(state = getDirtyState()) {
    return new Set([...(state.forms || []), ...(state.entries || []), ...(state.rules || [])]).size + (state.settings ? 1 : 0) + (state.tombstones ? 1 : 0) + (state.full ? 1 : 0);
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }

  function equivalent(a, b) {
    return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
  }

  function remoteMetaMarker(meta = {}) {
    return String(meta.updatedAt || meta.exportedAt || "");
  }

  function rememberRemoteMeta(meta = {}) {
    localStorage.setItem(REMOTE_META_KEY, JSON.stringify({ marker: remoteMetaMarker(meta), exists: Boolean(Object.keys(meta || {}).length), checkedAt: new Date().toISOString() }));
  }

  function lastRemoteMetaMarker() {
    try { return JSON.parse(localStorage.getItem(REMOTE_META_KEY) || "null")?.marker || ""; } catch { return ""; }
  }

  async function getRemoteMeta() {
    const snap = await sdk.getDoc(sdk.doc(db, ...userPath("sync", "meta")));
    diagnostics.reads += 1;
    const meta = snap.exists() ? snap.data() : {};
    return { exists: snap.exists(), meta };
  }

  async function getRemotePackage() {
    const [metaSnap, formsSnap, entriesSnap, rulesSnap] = await Promise.all([
      sdk.getDoc(sdk.doc(db, ...userPath("sync", "meta"))),
      sdk.getDocs(sdk.collection(db, ...userPath("forms"))),
      sdk.getDocs(sdk.collection(db, ...userPath("entries"))),
      sdk.getDocs(sdk.collection(db, ...userPath("rules")))
    ]);
    diagnostics.reads += 1 + formsSnap.size + entriesSnap.size + rulesSnap.size;

    const remoteIds = {
      forms: new Set(formsSnap.docs.map((d) => d.id)),
      entries: new Set(entriesSnap.docs.map((d) => d.id)),
      rules: new Set(rulesSnap.docs.map((d) => d.id))
    };
    const remoteRecords = {
      forms: new Map(formsSnap.docs.map((d) => [d.id, firestoreSafe(d.data())])),
      entries: new Map(entriesSnap.docs.map((d) => [d.id, firestoreSafe(d.data())])),
      rules: new Map(rulesSnap.docs.map((d) => [d.id, firestoreSafe(d.data())]))
    };
    const forms = new Map();
    for (const document of formsSnap.docs) {
      const raw = document.data();
      if (!raw?.id) continue;
      forms.set(raw.id, { ...raw, entries: [], questions: [] });
    }
    for (const document of entriesSnap.docs) {
      const raw = document.data();
      if (!raw?.formId) continue;
      if (!forms.has(raw.formId)) forms.set(raw.formId, { id: raw.formId, entries: [], questions: [] });
      forms.get(raw.formId).entries.push(raw);
    }
    for (const form of forms.values()) {
      form.entries.sort((a, b) => Number(a.entryNumber || 0) - Number(b.entryNumber || 0));
      form.questions = form.entries;
    }
    const rules = rulesSnap.docs.map((d) => d.data()).filter((v) => v && typeof v === "object");
    const meta = metaSnap.exists() ? metaSnap.data() : {};
    const exists = metaSnap.exists() || formsSnap.size > 0 || entriesSnap.size > 0 || rulesSnap.size > 0;

    return {
      exists,
      meta,
      remoteIds,
      remoteRecords,
      payload: {
        app: "ThunderShadow",
        version: Number(meta.version || 6),
        storage: "firebase-firestore",
        exportedAt: meta.exportedAt || new Date().toISOString(),
        schemaVersion: Number(meta.schemaVersion || 1),
        forms: [...forms.values()],
        rules,
        settings: meta.settings || {},
        tombstones: meta.tombstones || { forms: {}, rules: {}, entries: {} }
      }
    };
  }

  function packageCloudRecords(payload) {
    const forms = [];
    const entries = [];
    const rules = [];
    for (const form of payload.forms || []) {
      if (!form?.id) continue;
      const formDocId = encodeDocId(form.id);
      forms.push({ id: formDocId, data: firestoreSafe(stripFormEntries(form)) });
      for (const entry of form.entries || form.questions || []) {
        if (!entry || entry.entryNumber == null) continue;
        const id = encodeDocId(`${form.id}:${entry.entryNumber}`);
        entries.push({ id, data: firestoreSafe({ ...structuredClone(entry), formId: form.id }) });
      }
    }
    for (const rule of payload.rules || []) {
      if (!rule?.id) continue;
      rules.push({ id: encodeDocId(rule.id), data: firestoreSafe(structuredClone(rule)) });
    }
    return { forms, entries, rules };
  }

  async function commitOperations(operations) {
    const chunkSize = 400;
    for (let start = 0; start < operations.length; start += chunkSize) {
      const batch = sdk.writeBatch(db);
      for (const op of operations.slice(start, start + chunkSize)) {
        diagnostics.writesAttempted += 1;
        if (op.type === "delete") batch.delete(op.ref);
        else batch.set(op.ref, op.data);
      }
      await batch.commit();
    }
  }

  function desiredMeta(payload, previousMeta, dataChanged) {
    return {
      app: "ThunderShadow",
      version: Number(payload.version || 6),
      schemaVersion: Number(payload.schemaVersion || 1),
      exportedAt: dataChanged ? new Date().toISOString() : (previousMeta?.exportedAt || payload.exportedAt || new Date().toISOString()),
      updatedAt: dataChanged ? new Date().toISOString() : (previousMeta?.updatedAt || ""),
      lastModifiedBy: dataChanged ? deviceId : (previousMeta?.lastModifiedBy || deviceId),
      settings: firestoreSafe(payload.settings || {}),
      tombstones: firestoreSafe(payload.tombstones || { forms: {}, rules: {}, entries: {} })
    };
  }

  async function writeRemotePackage(payload, remote) {
    const records = packageCloudRecords(payload);
    const operations = [];
    const target = {
      forms: new Set(records.forms.map((v) => v.id)),
      entries: new Set(records.entries.map((v) => v.id)),
      rules: new Set(records.rules.map((v) => v.id))
    };

    for (const [kind, collection] of [["forms", records.forms], ["entries", records.entries], ["rules", records.rules]]) {
      for (const record of collection) {
        const existing = remote.remoteRecords[kind].get(record.id);
        if (existing && equivalent(existing, record.data)) {
          diagnostics.writesSkipped += 1;
          debug(`skip ${kind}/${record.id} unchanged`);
          continue;
        }
        operations.push({ type: "set", ref: sdk.doc(db, ...userPath(kind, record.id)), data: record.data, label: `${kind}/${record.id}` });
      }
    }

    for (const kind of ["forms", "entries", "rules"]) {
      for (const id of remote.remoteIds[kind] || []) {
        if (!target[kind].has(id)) operations.push({ type: "delete", ref: sdk.doc(db, ...userPath(kind, id)), label: `${kind}/${id}` });
      }
    }

    const recordChanges = operations.length;
    const metaCandidate = desiredMeta(payload, remote.meta, recordChanges > 0);
    const metaSemanticsChanged = remote.exists && !equivalent(
      { app: remote.meta?.app || "ThunderShadow", version: Number(remote.meta?.version || 6), schemaVersion: Number(remote.meta?.schemaVersion || 1), settings: remote.meta?.settings || {}, tombstones: remote.meta?.tombstones || { forms: {}, rules: {}, entries: {} } },
      { app: metaCandidate.app, version: metaCandidate.version, schemaVersion: metaCandidate.schemaVersion, settings: metaCandidate.settings, tombstones: metaCandidate.tombstones }
    );
    const shouldWriteMeta = recordChanges > 0 || metaSemanticsChanged;

    if (operations.length) {
      for (const op of operations) debug(`${op.type === "delete" ? "delete" : "write"} ${op.label}`);
      await commitOperations(operations);
    }
    if (shouldWriteMeta) {
      diagnostics.writesAttempted += 1;
      await sdk.setDoc(sdk.doc(db, ...userPath("sync", "meta")), metaCandidate);
      debug("write sync/meta");
      rememberRemoteMeta(metaCandidate);
    } else {
      diagnostics.writesSkipped += 1;
      rememberRemoteMeta(remote.meta || {});
      debug("skip sync/meta unchanged");
    }
    return { writes: recordChanges + (shouldWriteMeta ? 1 : 0), skipped: diagnostics.writesSkipped, meta: shouldWriteMeta ? metaCandidate : remote.meta };
  }

  async function syncNow({ background = false, reason = "manual" } = {}) {
    if (!currentUser) {
      if (!background) return connect();
      setState("signedout", "Progress is saved locally. Sign in with Google to enable cloud sync.");
      throw new Error("Firebase user is not signed in.");
    }
    if (!db) throw new Error("Firestore is not initialized.");
    if (syncPromise) return syncPromise;

    const dirtyAtStart = getDirtyState();
    const beforeReads = diagnostics.reads;
    const beforeWrites = diagnostics.writesAttempted;
    const beforeSkipped = diagnostics.writesSkipped;
    diagnostics.syncs += 1;
    debug(`trigger=${reason} dirty=${dirtyCount(dirtyAtStart)}`);

    syncPromise = (async () => {
      setState("syncing", background ? "Synchronizing changes with Firebase…" : "Synchronizing browser data with Firebase…");
      const remote = await getRemotePackage();
      let merged;
      if (remote.exists) merged = await window.ThunderShadowBrowserApi.mergePackage(remote.payload);
      else merged = await window.ThunderShadowBrowserApi.exportPackage();

      const result = await writeRemotePackage(merged, remote);
      const dirtyAfterSync = getDirtyState();
      if (!dirtyAfterSync.dirty || dirtyAfterSync.updatedAt === dirtyAtStart.updatedAt) clearDirtyState();
      else scheduleSync({ reason: "edit-during-sync" });
      lastSyncedAt = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, lastSyncedAt);
      setState("synced", "Browser data and Firebase are synchronized.");
      window.dispatchEvent(new CustomEvent("thundershadow-cloud-merged", { detail: { uid: currentUser.uid, reason, writes: result.writes } }));
      debug(`complete reason=${reason} reads=${diagnostics.reads - beforeReads} writes=${diagnostics.writesAttempted - beforeWrites} skipped=${diagnostics.writesSkipped - beforeSkipped}`);
      return merged;
    })().catch((error) => {
      const code = String(error?.code || "");
      if (code.includes("permission-denied") || code.includes("unauthenticated")) {
        setState("error", `Firebase access failed: ${error.message}. Local browser data is safe.`);
      } else if (!navigator.onLine) {
        setState("offline", "Offline — changes are saved locally and will sync when internet returns.");
      } else {
        setState("error", `Cloud sync failed: ${error?.message || error}. Local browser data is safe.`);
      }
      throw error;
    }).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function checkRemoteChanged(reason) {
    if (!currentUser || !navigator.onLine) return false;
    if (remoteCheckPromise) return remoteCheckPromise;
    if (Date.now() - lastRemoteCheckAt < 5000) {
      debug(`skip remote-check reason=${reason} throttled`);
      return false;
    }
    remoteCheckPromise = (async () => {
      const { exists, meta } = await getRemoteMeta();
      lastRemoteCheckAt = Date.now();
      const previous = lastRemoteMetaMarker();
      const current = remoteMetaMarker(meta);
      rememberRemoteMeta(meta);
      debug(`remote-check reason=${reason} exists=${exists} changed=${Boolean(current && current !== previous)}`);
      if (!exists) return false;
      if (!previous) return true;
      return current !== previous;
    })().finally(() => { remoteCheckPromise = null; });
    return remoteCheckPromise;
  }

  async function startupSyncCheck() {
    if (!currentUser || !navigator.onLine) return;
    const dirty = getDirtyState();
    if (dirty.dirty) return syncNow({ background: true, reason: "startup-dirty" });
    const knownMarker = lastRemoteMetaMarker();
    if (!knownMarker) return syncNow({ background: true, reason: "startup-initial-check" });
    if (await checkRemoteChanged("startup-clean")) return syncNow({ background: true, reason: "startup-remote-change" });
    setState("synced", "Browser data and Firebase are synchronized.");
  }

  function scheduleSync({ reason = "local-edit", immediate = false } = {}) {
    if (!currentUser) return;
    const dirty = getDirtyState();
    if (!dirty.dirty) {
      debug(`skip trigger=${reason} clean`);
      return;
    }
    clearTimeout(syncTimer);
    const run = () => {
      if (navigator.onLine) syncNow({ background: true, reason }).catch(() => {});
    };
    if (immediate) run();
    else syncTimer = setTimeout(run, SYNC_DEBOUNCE_MS);
  }

  async function handleForeground() {
    if (!currentUser || !navigator.onLine) return;
    if (getDirtyState().dirty) return scheduleSync({ reason: "foreground-dirty", immediate: true });
    if (await checkRemoteChanged("foreground-clean")) return syncNow({ background: true, reason: "foreground-remote-change" });
  }

  function handleLocalMutation(event) {
    const detail = event?.detail || {};
    scheduleSync({ reason: detail.kind || "local-edit", immediate: Boolean(detail.immediate) });
  }

  function getDiagnostics() {
    return { ...diagnostics, dirty: getDirtyState(), debounceMs: SYNC_DEBOUNCE_MS };
  }

  async function disconnect() {
    clearTimeout(syncTimer);
    if (auth) await sdk.signOut(auth);
    currentUser = null;
    localStorage.removeItem(ENABLED_KEY);
    setState("signedout", "Signed out on this device. ThunderShadow continues using local browser storage.");
  }

  function bindDom() {
    document.getElementById("firebaseConnectBtn")?.addEventListener("click", () => connect().catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
    document.getElementById("firebaseSyncNowBtn")?.addEventListener("click", () => syncNow({ background: false, reason: "manual-sync" }).catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
    document.getElementById("firebaseDisconnectBtn")?.addEventListener("click", () => disconnect().catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
    updateDom();
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    bindDom();
    emit();
    try {
      if (!(await initFirebase())) return;
      await consumeDirectGoogleRedirect();
    } catch (error) {
      setState("error", `Firebase initialization failed: ${error?.message || error}. Local browser data is safe.`);
    }

    if (!listenersBound) {
      listenersBound = true;
      addEventListener("thundershadow-local-data-changed", handleLocalMutation);
      addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") handleForeground().catch(() => {});
      });
      addEventListener("pageshow", () => handleForeground().catch(() => {}));
      addEventListener("focus", () => handleForeground().catch(() => {}));
      addEventListener("online", () => {
        if (currentUser && getDirtyState().dirty) scheduleSync({ reason: "online-dirty", immediate: true });
      });
    }
  }

  window.ThunderShadowFirebase = {
    initialize,
    connect,
    disconnect,
    syncNow,
    scheduleSync,
    getStatus,
    isAuthorized,
    getDirtyState,
    getDiagnostics,
    checkRemoteChanged
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
