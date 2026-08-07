(() => {
  "use strict";

  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const DRIVE_API = "https://www.googleapis.com/drive/v3";
  const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const LEGACY_CLIENT_ID_KEY = "thundershadow:google-client-id";
  const ENABLED_KEY = "thundershadow:drive-enabled";
  const FILE_ID_KEY = "thundershadow:drive-file-id";
  const LAST_SYNC_KEY = "thundershadow:drive-last-sync";
  const TOKEN_KEY = "thundershadow:drive-access-token";
  const TOKEN_EXPIRY_KEY = "thundershadow:drive-token-expiry";
  const DEVICE_ID_KEY = "thundershadow:drive-device-id";
  const ACCOUNT_LABEL_KEY = "thundershadow:drive-account-label";
  const REDIRECT_STATE_KEY = "thundershadow:drive-redirect-state";
  const REDIRECT_STARTED_KEY = "thundershadow:drive-redirect-started";

  let tokenClient = null;
  let accessToken = sessionStorage.getItem(TOKEN_KEY) || "";
  let tokenExpiry = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
  let syncTimer = null;
  let syncPromise = null;
  let connectPromise = null;
  let accountLabel = localStorage.getItem(ACCOUNT_LABEL_KEY) || "";
  let state = localStorage.getItem(ENABLED_KEY) === "1" ? "reauth" : "disabled";
  let message = state === "reauth" ? "Google Drive was enabled previously. Reconnect to resume cloud sync." : "Browser storage is active. Google Drive sync is optional.";
  let lastSyncedAt = localStorage.getItem(LAST_SYNC_KEY) || null;
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = window.ThunderShadowUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  // Public release: one OAuth client is shipped with the app. Remove any legacy
  // per-browser override so every device authorizes against the same Google app.
  localStorage.removeItem(LEGACY_CLIENT_ID_KEY);

  if (accessToken && tokenExpiry > Date.now() + 30_000) {
    state = "ready";
    message = "Google Drive authorization restored for this browser session.";
  } else {
    clearTokenOnly();
  }

  function clearTokenOnly() {
    accessToken = "";
    tokenExpiry = 0;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  }

  function emit() {
    const detail = getStatus();
    window.dispatchEvent(new CustomEvent("thundershadow-drive-status", { detail }));
    updateDom(detail);
  }

  function getStatus() {
    return {
      state,
      message,
      lastSyncedAt,
      accountLabel,
      authorized: isAuthorized(),
      enabled: localStorage.getItem(ENABLED_KEY) === "1"
    };
  }

  function isAuthorized() {
    return Boolean(accessToken && tokenExpiry > Date.now() + 30_000);
  }

  function effectiveClientId() {
    return String(window.THUNDERSHADOW_CONFIG?.googleClientId || "").trim();
  }

  function setState(next, nextMessage) {
    state = next;
    if (nextMessage) message = nextMessage;
    emit();
  }

  function prettyTime(value) {
    if (!value) return "Never";
    try { return new Date(value).toLocaleString(); } catch { return value; }
  }

  function updateDom(detail = getStatus()) {
    const status = document.getElementById("driveStatusText");
    const detailText = document.getElementById("driveDetailText");
    const connect = document.getElementById("driveConnectBtn");
    const sync = document.getElementById("driveSyncNowBtn");
    const disconnect = document.getElementById("driveDisconnectBtn");

    if (status) status.textContent = detail.message;
    if (detailText) {
      const account = detail.accountLabel ? ` Connected Google account: ${detail.accountLabel}.` : "";
      detailText.textContent = detail.enabled
        ? `Last successful Drive sync: ${prettyTime(detail.lastSyncedAt)}.${account} Local browser data remains authoritative when Drive is unavailable.`
        : "Local IndexedDB is the default store. Drive uses a hidden app-data file and can be disconnected from this browser at any time.";
    }
    if (connect) {
      connect.textContent = detail.authorized ? "Drive connected" : (detail.enabled ? "Reconnect Drive" : "Connect Google Drive");
      connect.disabled = detail.authorized || detail.state === "connecting" || detail.state === "syncing";
    }
    // Sync Now remains usable when Drive was previously enabled. If the token
    // has expired, clicking it starts a fresh user-authorized token flow.
    if (sync) sync.disabled = !detail.enabled || detail.state === "connecting" || detail.state === "syncing";
    if (disconnect) disconnect.disabled = !detail.enabled && !detail.authorized;
  }

  function isStandalonePwa() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true
      || window.navigator.standalone === true;
  }

  function isAppleMobile() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function useRedirectOAuthFallback() {
    // Google Identity Services' token UX is popup-based. iOS/iPadOS Home-Screen
    // apps can suppress that popup. Use a same-origin OAuth redirect only there.
    return isStandalonePwa() && isAppleMobile();
  }

  function oauthRedirectUri() {
    // The PWA start_url is the repository root (./). Keep the OAuth redirect on
    // that canonical URL so iOS returns to the installed Home-Screen app.
    const url = new URL("./", window.location.href);
    url.hash = "";
    url.search = "";
    return url.href;
  }

  function randomState() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function beginRedirectOAuth() {
    const clientId = effectiveClientId();
    if (!clientId || clientId.includes("YOUR_THUNDERSHADOW_PUBLIC_OAUTH_CLIENT_ID")) {
      throw new Error("ThunderShadow's public Google OAuth Client ID has not been configured in js/config.js.");
    }

    const stateValue = randomState();
    sessionStorage.setItem(REDIRECT_STATE_KEY, stateValue);
    sessionStorage.setItem(REDIRECT_STARTED_KEY, "1");
    localStorage.setItem(ENABLED_KEY, "1");

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: oauthRedirectUri(),
      response_type: "token",
      scope: SCOPE,
      state: stateValue,
      include_granted_scopes: "true",
      prompt: "select_account"
    });

    // Same-window navigation is intentional: it works inside an installed
    // iOS/iPadOS PWA where a popup window may not open.
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }

  async function consumeRedirectOAuthResponse() {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasOAuthResponse = fragment.has("access_token") || fragment.has("error");
    if (!hasOAuthResponse) return false;

    const expectedState = sessionStorage.getItem(REDIRECT_STATE_KEY) || "";
    const returnedState = fragment.get("state") || "";
    sessionStorage.removeItem(REDIRECT_STATE_KEY);
    sessionStorage.removeItem(REDIRECT_STARTED_KEY);

    // Remove access-token/error material from the visible URL immediately.
    history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);

    if (!expectedState || returnedState !== expectedState) {
      clearTokenOnly();
      setState("reauth", "Google Drive authorization could not be verified. Tap Reconnect Drive and try again.");
      return true;
    }

    if (fragment.has("error")) {
      const description = fragment.get("error_description") || fragment.get("error") || "Google authorization was denied.";
      clearTokenOnly();
      setState("reauth", `${description} Local browser data is safe.`);
      return true;
    }

    const token = fragment.get("access_token") || "";
    if (!token) {
      clearTokenOnly();
      setState("reauth", "Google authorization returned without an access token. Tap Reconnect Drive.");
      return true;
    }

    accessToken = token;
    tokenExpiry = Date.now() + Math.max(60, Number(fragment.get("expires_in") || 3600)) * 1000;
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(tokenExpiry));
    localStorage.setItem(ENABLED_KEY, "1");

    try {
      setState("connecting", "Google authorized. Validating Drive access…");
      await validateFreshToken();
    } catch (error) {
      // Only an actual token/Drive validation failure should discard auth.
      clearTokenOnly();
      setState("reauth", `${error.message} Local browser data is safe; tap Reconnect Drive to try again.`);
      return true;
    }

    // Authorization is valid at this point. A merge/storage/application error is
    // NOT an OAuth failure and must not throw away a good Google token.
    setState("ready", "Google Drive authorized. Running bidirectional sync…");
    try {
      await syncNow({ background: false });
    } catch (error) {
      setState("error", `Drive is connected, but sync failed: ${error.message}. Local browser data is safe. Tap Sync Now after updating/reloading the app.`);
    }
    return true;
  }

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("Google Identity Services could not be loaded.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Google Identity Services could not be loaded."));
      document.head.appendChild(script);
    });
  }

  async function parseGoogleError(response) {
    let message = "";
    let reason = "";
    try {
      const payload = await response.clone().json();
      message = payload?.error?.message || payload?.error_description || "";
      reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || payload?.error || "";
    } catch {
      try { message = (await response.clone().text()).slice(0, 500); } catch {}
    }
    return { message, reason };
  }

  async function rawDriveFetch(url, options = {}) {
    if (!accessToken) throw new Error("Google Drive did not return an access token. Reconnect Drive and try again.");
    const headers = { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) };
    return fetch(url, { ...options, cache: "no-store", headers });
  }

  async function validateFreshToken() {
    // Validate the exact bearer token against Drive before touching the sync file.
    // about.get is supported by drive.appdata and also lets us show which account
    // the browser actually authorized.
    const response = await rawDriveFetch(`${DRIVE_API}/about?fields=user(displayName,emailAddress)`);
    if (!response.ok) {
      const info = await parseGoogleError(response);
      const suffix = info.reason ? ` [${info.reason}]` : "";
      const detail = info.message || `HTTP ${response.status}`;
      throw new Error(`Google rejected the newly issued Drive token: ${detail}${suffix}`);
    }
    const data = await response.json();
    accountLabel = data?.user?.emailAddress || data?.user?.displayName || "";
    if (accountLabel) localStorage.setItem(ACCOUNT_LABEL_KEY, accountLabel);
    return data;
  }

  async function initTokenClient() {
    const clientId = effectiveClientId();
    if (!clientId || clientId.includes("YOUR_THUNDERSHADOW_PUBLIC_OAUTH_CLIENT_ID")) {
      throw new Error("ThunderShadow's public Google OAuth Client ID has not been configured in js/config.js.");
    }

    await loadGis();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      include_granted_scopes: true,
      callback: async (response) => {
        if (response?.error) {
          const err = new Error(response.error_description || response.error);
          setState("error", err.message);
          if (connectPromise?.reject) connectPromise.reject(err);
          connectPromise = null;
          return;
        }

        if (!response?.access_token) {
          const err = new Error("Google authorization completed but no access token was returned.");
          setState("error", err.message);
          if (connectPromise?.reject) connectPromise.reject(err);
          connectPromise = null;
          return;
        }

        if (window.google?.accounts?.oauth2?.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
          const err = new Error("Google Drive app-data permission was not granted. Connect again and allow ThunderShadow's Drive access.");
          setState("error", err.message);
          if (connectPromise?.reject) connectPromise.reject(err);
          connectPromise = null;
          return;
        }

        accessToken = response.access_token;
        tokenExpiry = Date.now() + Math.max(60, Number(response.expires_in || 3600)) * 1000;
        sessionStorage.setItem(TOKEN_KEY, accessToken);
        sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(tokenExpiry));
        localStorage.setItem(ENABLED_KEY, "1");

        try {
          setState("connecting", "Google authorized. Validating Drive access…");
          await validateFreshToken();
        } catch (error) {
          // Only a failed token/Drive validation invalidates this browser's auth.
          clearTokenOnly();
          setState("reauth", `${error.message} Local browser data is safe; tap Reconnect Drive to try again.`);
          if (connectPromise?.reject) connectPromise.reject(error);
          connectPromise = null;
          return;
        }

        // Keep valid authorization even if application merge/storage code fails.
        setState("ready", "Google Drive authorized. Running bidirectional sync…");
        try {
          await syncNow({ background: false });
          if (connectPromise?.resolve) connectPromise.resolve();
        } catch (error) {
          setState("error", `Drive is connected, but sync failed: ${error.message}. Local browser data is safe.`);
          if (connectPromise?.reject) connectPromise.reject(error);
        } finally {
          connectPromise = null;
        }
      },
      error_callback: (error) => {
        const err = new Error(error?.type === "popup_closed" ? "Google authorization window was closed." : "Google authorization could not be completed.");
        setState("error", err.message);
        if (connectPromise?.reject) connectPromise.reject(err);
        connectPromise = null;
      }
    });
  }

  async function connect() {
    if (connectPromise) return connectPromise.promise;
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    connectPromise = { promise, resolve, reject };

    try {
      setState("connecting", useRedirectOAuthFallback()
        ? "Opening Google authorization in this Home-Screen app…"
        : "Opening Google authorization…");

      if (useRedirectOAuthFallback()) {
        // Navigation leaves this JS context, so there is no promise to resolve
        // here. The returned OAuth fragment is consumed on the next app load.
        connectPromise = null;
        beginRedirectOAuth();
        return promise;
      }

      await initTokenClient();
      // Normal browsers keep the preferred Google Identity Services popup flow.
      tokenClient.requestAccessToken({ prompt: "consent select_account", scope: SCOPE });
    } catch (error) {
      setState("error", error.message);
      if (connectPromise?.reject) connectPromise.reject(error);
      connectPromise = null;
    }
    return promise;
  }

  function authHeaders(extra = {}) {
    if (!isAuthorized()) throw new Error("Google Drive authorization is not active in this browser. Tap Reconnect Drive.");
    return { Authorization: `Bearer ${accessToken}`, ...extra };
  }

  async function driveFetch(url, options = {}) {
    const response = await fetch(url, { ...options, cache: "no-store", headers: authHeaders(options.headers || {}) });

    if (response.status === 401) {
      const info = await parseGoogleError(response);
      clearTokenOnly();
      const suffix = info.reason ? ` [${info.reason}]` : "";
      const detail = info.message || "Google rejected the bearer token";
      setState("reauth", `Drive authorization is no longer valid: ${detail}${suffix}. Local saving continues; tap Reconnect Drive.`);
      throw new Error(`Drive authorization failed: ${detail}${suffix}`);
    }

    if (!response.ok) {
      const info = await parseGoogleError(response);
      const suffix = info.reason ? ` [${info.reason}]` : "";
      throw new Error(info.message ? `Google Drive ${response.status}: ${info.message}${suffix}` : `Google Drive request failed (${response.status})${suffix}.`);
    }
    return response;
  }

  function escapedDriveQueryName(name) { return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

  async function findFile() {
    const configured = window.THUNDERSHADOW_CONFIG?.driveFileName || "ThunderShadow.sync.json";
    const cachedId = localStorage.getItem(FILE_ID_KEY);
    if (cachedId) {
      const check = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(cachedId)}?fields=id,name,modifiedTime,size`).catch((error) => {
        if (!isAuthorized()) throw error;
        return null;
      });
      if (check) return check.json();
      localStorage.removeItem(FILE_ID_KEY);
    }
    const params = new URLSearchParams({
      spaces: "appDataFolder",
      q: `name='${escapedDriveQueryName(configured)}' and trashed=false`,
      fields: "files(id,name,modifiedTime,size)",
      pageSize: "10",
      orderBy: "modifiedTime desc"
    });
    const response = await driveFetch(`${DRIVE_API}/files?${params}`);
    const files = (await response.json()).files || [];
    const file = files[0] || null;
    if (file?.id) localStorage.setItem(FILE_ID_KEY, file.id);
    return file;
  }

  async function downloadFile(fileId) {
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
    const payload = await response.json();
    if (payload?.app !== "ThunderShadow") throw new Error("The Drive sync file is not a ThunderShadow data package.");
    return payload;
  }

  async function uploadMedia(fileId, payload) {
    const response = await driveFetch(`${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,size`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  async function createFile(payload) {
    const name = window.THUNDERSHADOW_CONFIG?.driveFileName || "ThunderShadow.sync.json";
    const metadataResponse = await driveFetch(`${DRIVE_API}/files?fields=id,name,modifiedTime,size`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        name,
        parents: ["appDataFolder"],
        mimeType: "application/json",
        appProperties: { app: "ThunderShadow", format: "browser-sync-v1" }
      })
    });
    const metadata = await metadataResponse.json();
    localStorage.setItem(FILE_ID_KEY, metadata.id);
    return uploadMedia(metadata.id, payload);
  }

  async function syncNow({ background = false } = {}) {
    if (!isAuthorized()) {
      if (!background && localStorage.getItem(ENABLED_KEY) === "1") return connect();
      setState(localStorage.getItem(ENABLED_KEY) === "1" ? "reauth" : "disabled",
        localStorage.getItem(ENABLED_KEY) === "1" ? "Reconnect Google Drive to resume cloud sync. Local browser saving is unaffected." : "Google Drive sync is not enabled.");
      throw new Error("Google Drive is not authorized.");
    }

    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      setState("syncing", background ? "Saving changes to Google Drive…" : "Synchronizing browser data with Google Drive…");
      const remoteFile = await findFile();
      let merged;
      if (remoteFile) {
        const remote = await downloadFile(remoteFile.id);
        merged = await window.ThunderShadowBrowserApi.mergePackage(remote);
        merged.sync = { deviceId, syncedAt: new Date().toISOString(), format: "browser-sync-v1" };
        await uploadMedia(remoteFile.id, merged);
        localStorage.setItem(FILE_ID_KEY, remoteFile.id);
        window.dispatchEvent(new CustomEvent("thundershadow-drive-merged", { detail: { fileId: remoteFile.id } }));
      } else {
        merged = await window.ThunderShadowBrowserApi.exportPackage();
        merged.sync = { deviceId, syncedAt: new Date().toISOString(), format: "browser-sync-v1" };
        const created = await createFile(merged);
        localStorage.setItem(FILE_ID_KEY, created.id);
      }
      lastSyncedAt = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, lastSyncedAt);
      setState("synced", "Browser data and Google Drive are synchronized.");
      return merged;
    })().catch((error) => {
      if (state !== "reauth") setState("error", `Drive sync failed: ${error.message}. Local browser data is safe.`);
      throw error;
    }).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function scheduleSync() {
    if (!isAuthorized()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (document.visibilityState === "visible") syncNow({ background: true }).catch(() => {});
    }, 1800);
  }

  async function disconnect() {
    // LOCAL disconnect only. Do NOT call google.accounts.oauth2.revoke() here:
    // Google's revoke operation removes the user's grant for this OAuth client
    // and can break ThunderShadow sync on their other devices.
    clearTimeout(syncTimer);
    clearTokenOnly();
    tokenClient = null;
    localStorage.removeItem(ENABLED_KEY);
    localStorage.removeItem(FILE_ID_KEY);
    localStorage.removeItem(ACCOUNT_LABEL_KEY);
    accountLabel = "";
    setState("disabled", "Google Drive disconnected from this browser. Other devices are unaffected; ThunderShadow continues using browser storage only.");
  }

  function bindDom() {
    const connectBtn = document.getElementById("driveConnectBtn");
    const syncBtn = document.getElementById("driveSyncNowBtn");
    const disconnectBtn = document.getElementById("driveDisconnectBtn");
    connectBtn?.addEventListener("click", () => connect().catch((error) => window.ThunderShadowApp?.showToast?.(error.message)));
    syncBtn?.addEventListener("click", () => syncNow({ background: false }).catch((error) => window.ThunderShadowApp?.showToast?.(error.message)));
    disconnectBtn?.addEventListener("click", () => disconnect().catch((error) => window.ThunderShadowApp?.showToast?.(error.message)));
    updateDom();
  }

  async function initialize() {
    bindDom();
    emit();

    const consumedRedirect = await consumeRedirectOAuthResponse().catch((error) => {
      setState("reauth", `Google Drive authorization failed: ${error.message}. Local browser data is safe.`);
      return true;
    });

    if (!consumedRedirect && isAuthorized()) {
      setTimeout(() => syncNow({ background: true }).catch(() => {}), 700);
    }

    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isAuthorized() && Date.now() + 60_000 < tokenExpiry) scheduleSync();
    });
  }

  window.ThunderShadowDrive = {
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
