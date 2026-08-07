(() => {
  "use strict";

  const FIREBASE_VERSION = "12.16.0";
  const ENABLED_KEY = "thundershadow:firebase-enabled";
  const LAST_SYNC_KEY = "thundershadow:firebase-last-sync";
  const DEVICE_ID_KEY = "thundershadow:firebase-device-id";
  const REDIRECT_STATE_KEY = "thundershadow:firebase-google-redirect-state";

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
        setTimeout(() => syncNow({ background: true }).catch(() => {}), 700);
      } else {
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

  async function getRemotePackage() {
    const [metaSnap, formsSnap, entriesSnap, rulesSnap] = await Promise.all([
      sdk.getDoc(sdk.doc(db, ...userPath("sync", "meta"))),
      sdk.getDocs(sdk.collection(db, ...userPath("forms"))),
      sdk.getDocs(sdk.collection(db, ...userPath("entries"))),
      sdk.getDocs(sdk.collection(db, ...userPath("rules")))
    ]);

    const remoteIds = {
      forms: new Set(formsSnap.docs.map((d) => d.id)),
      entries: new Set(entriesSnap.docs.map((d) => d.id)),
      rules: new Set(rulesSnap.docs.map((d) => d.id))
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
      remoteIds,
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
        if (op.type === "delete") batch.delete(op.ref);
        else batch.set(op.ref, op.data);
      }
      await batch.commit();
    }
  }

  async function writeRemotePackage(payload, remoteIds = { forms: new Set(), entries: new Set(), rules: new Set() }) {
    const records = packageCloudRecords(payload);
    const operations = [];
    const target = {
      forms: new Set(records.forms.map((v) => v.id)),
      entries: new Set(records.entries.map((v) => v.id)),
      rules: new Set(records.rules.map((v) => v.id))
    };

    for (const record of records.forms) operations.push({ type: "set", ref: sdk.doc(db, ...userPath("forms", record.id)), data: record.data });
    for (const record of records.entries) operations.push({ type: "set", ref: sdk.doc(db, ...userPath("entries", record.id)), data: record.data });
    for (const record of records.rules) operations.push({ type: "set", ref: sdk.doc(db, ...userPath("rules", record.id)), data: record.data });

    for (const id of remoteIds.forms || []) if (!target.forms.has(id)) operations.push({ type: "delete", ref: sdk.doc(db, ...userPath("forms", id)) });
    for (const id of remoteIds.entries || []) if (!target.entries.has(id)) operations.push({ type: "delete", ref: sdk.doc(db, ...userPath("entries", id)) });
    for (const id of remoteIds.rules || []) if (!target.rules.has(id)) operations.push({ type: "delete", ref: sdk.doc(db, ...userPath("rules", id)) });

    await commitOperations(operations);
    await sdk.setDoc(sdk.doc(db, ...userPath("sync", "meta")), {
      app: "ThunderShadow",
      version: Number(payload.version || 6),
      schemaVersion: Number(payload.schemaVersion || 1),
      exportedAt: payload.exportedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastModifiedBy: deviceId,
      settings: firestoreSafe(payload.settings || {}),
      tombstones: firestoreSafe(payload.tombstones || { forms: {}, rules: {}, entries: {} })
    });
  }

  async function syncNow({ background = false } = {}) {
    if (!currentUser) {
      if (!background) return connect();
      setState("signedout", "Progress is saved locally. Sign in with Google to enable cloud sync.");
      throw new Error("Firebase user is not signed in.");
    }
    if (!db) throw new Error("Firestore is not initialized.");
    if (syncPromise) return syncPromise;

    syncPromise = (async () => {
      setState("syncing", background ? "Synchronizing changes with Firebase…" : "Synchronizing browser data with Firebase…");
      const remote = await getRemotePackage();
      let merged;
      if (remote.exists) merged = await window.ThunderShadowBrowserApi.mergePackage(remote.payload);
      else merged = await window.ThunderShadowBrowserApi.exportPackage();

      merged.sync = { deviceId, syncedAt: new Date().toISOString(), format: "firebase-firestore-v1" };
      await writeRemotePackage(merged, remote.remoteIds);
      lastSyncedAt = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, lastSyncedAt);
      setState("synced", "Browser data and Firebase are synchronized.");
      window.dispatchEvent(new CustomEvent("thundershadow-cloud-merged", { detail: { uid: currentUser.uid } }));
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

  function scheduleSync() {
    if (!currentUser) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (document.visibilityState === "visible" && navigator.onLine) syncNow({ background: true }).catch(() => {});
    }, 1800);
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
    document.getElementById("firebaseSyncNowBtn")?.addEventListener("click", () => syncNow({ background: false }).catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
    document.getElementById("firebaseDisconnectBtn")?.addEventListener("click", () => disconnect().catch((e) => window.ThunderShadowApp?.showToast?.(e.message)));
    updateDom();
  }

  async function initialize() {
    bindDom();
    emit();
    try {
      if (!(await initFirebase())) return;
      const consumed = await consumeDirectGoogleRedirect();
      if (consumed && currentUser) setTimeout(() => syncNow({ background: false }).catch(() => {}), 300);
    } catch (error) {
      setState("error", `Firebase initialization failed: ${error?.message || error}. Local browser data is safe.`);
    }

    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && currentUser && navigator.onLine) scheduleSync();
    });
    addEventListener("online", () => { if (currentUser) scheduleSync(); });
  }

  window.ThunderShadowFirebase = {
    initialize,
    connect,
    disconnect,
    syncNow,
    scheduleSync,
    getStatus,
    isAuthorized
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
