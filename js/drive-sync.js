(() => {
  "use strict";

  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const DRIVE_API = "https://www.googleapis.com/drive/v3";
  const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const CLIENT_ID_KEY = "thundershadow:google-client-id";
  const ENABLED_KEY = "thundershadow:drive-enabled";
  const FILE_ID_KEY = "thundershadow:drive-file-id";
  const LAST_SYNC_KEY = "thundershadow:drive-last-sync";
  const TOKEN_KEY = "thundershadow:drive-access-token";
  const TOKEN_EXPIRY_KEY = "thundershadow:drive-token-expiry";
  const DEVICE_ID_KEY = "thundershadow:drive-device-id";
  let tokenClient = null;
  let accessToken = sessionStorage.getItem(TOKEN_KEY) || "";
  let tokenExpiry = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
  let syncTimer = null;
  let syncPromise = null;
  let state = localStorage.getItem(ENABLED_KEY) === "1" ? "reauth" : "disabled";
  let message = state === "reauth" ? "Google Drive was enabled previously. Reconnect to resume cloud sync." : "Browser storage is active. Google Drive sync is optional.";
  let lastSyncedAt = localStorage.getItem(LAST_SYNC_KEY) || null;
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) { deviceId = window.ThunderShadowUUID(); localStorage.setItem(DEVICE_ID_KEY, deviceId); }
  if (accessToken && tokenExpiry > Date.now() + 30_000) { state = "ready"; message = "Google Drive authorization restored for this browser session."; }
  else { accessToken = ""; tokenExpiry = 0; sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_EXPIRY_KEY); }

  function emit() {
    const detail = getStatus();
    window.dispatchEvent(new CustomEvent("thundershadow-drive-status", { detail }));
    updateDom(detail);
  }

  function getStatus() { return { state, message, lastSyncedAt, authorized: isAuthorized(), enabled: localStorage.getItem(ENABLED_KEY) === "1" }; }
  function isAuthorized() { return Boolean(accessToken && tokenExpiry > Date.now() + 30_000); }
  function effectiveClientId() { return (localStorage.getItem(CLIENT_ID_KEY) || window.THUNDERSHADOW_CONFIG?.googleClientId || "").trim(); }
  function setState(next, nextMessage) { state = next; if (nextMessage) message = nextMessage; emit(); }
  function prettyTime(value) { if (!value) return "Never"; try { return new Date(value).toLocaleString(); } catch { return value; } }

  function updateDom(detail = getStatus()) {
    const status = document.getElementById("driveStatusText");
    const detailText = document.getElementById("driveDetailText");
    const connect = document.getElementById("driveConnectBtn");
    const sync = document.getElementById("driveSyncNowBtn");
    const disconnect = document.getElementById("driveDisconnectBtn");
    const input = document.getElementById("googleClientIdInput");
    if (status) status.textContent = detail.message;
    if (detailText) detailText.textContent = detail.enabled ? `Last successful Drive sync: ${prettyTime(detail.lastSyncedAt)}. Local browser data remains authoritative when Drive is unavailable.` : "Local IndexedDB is the default store. Drive uses a hidden app-data file and can be disconnected at any time.";
    if (connect) { connect.textContent = detail.authorized ? "Drive connected" : (detail.enabled ? "Reconnect Drive" : "Connect Google Drive"); connect.disabled = detail.authorized || detail.state === "connecting" || detail.state === "syncing"; }
    if (sync) sync.disabled = !detail.authorized || detail.state === "syncing";
    if (disconnect) disconnect.disabled = !detail.enabled && !detail.authorized;
    if (input && !input.value) input.value = effectiveClientId();
  }

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
      if (existing) { existing.addEventListener("load", resolve, { once: true }); existing.addEventListener("error", () => reject(new Error("Google Identity Services could not be loaded.")), { once: true }); return; }
      const script = document.createElement("script"); script.src = GIS_SRC; script.async = true; script.defer = true; script.onload = resolve; script.onerror = () => reject(new Error("Google Identity Services could not be loaded.")); document.head.appendChild(script);
    });
  }

  async function initTokenClient() {
    const clientId = effectiveClientId();
    if (!clientId) throw new Error("Add a Google OAuth Web Client ID in Settings before connecting Drive.");
    await loadGis();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      include_granted_scopes: true,
      callback: async (response) => {
        if (response?.error) { setState("error", response.error_description || response.error); return; }
        accessToken = response.access_token;
        tokenExpiry = Date.now() + Math.max(60, Number(response.expires_in || 3600)) * 1000;
        sessionStorage.setItem(TOKEN_KEY, accessToken);
        sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(tokenExpiry));
        localStorage.setItem(ENABLED_KEY, "1");
        setState("ready", "Google Drive authorized. Running bidirectional sync…");
        try { await syncNow({ background: false }); }
        catch (error) { setState("error", error.message); }
      }
    });
  }

  async function connect() {
    try {
      setState("connecting", "Opening Google authorization…");
      await initTokenClient();
      tokenClient.requestAccessToken({ prompt: localStorage.getItem(ENABLED_KEY) === "1" ? "" : "consent" });
    } catch (error) { setState("error", error.message); throw error; }
  }

  function authHeaders(extra = {}) {
    if (!isAuthorized()) throw new Error("Google Drive authorization expired. Tap Reconnect Drive to continue cloud sync.");
    return { Authorization: `Bearer ${accessToken}`, ...extra };
  }

  async function driveFetch(url, options = {}) {
    const response = await fetch(url, { ...options, cache: "no-store", headers: authHeaders(options.headers || {}) });
    if (response.status === 401 || response.status === 403) {
      accessToken = ""; tokenExpiry = 0; sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
      setState("reauth", "Google Drive authorization expired. Local saving continues; tap Reconnect Drive to resume cloud sync.");
      throw new Error("Google Drive authorization expired.");
    }
    if (!response.ok) {
      let details = ""; try { details = (await response.json())?.error?.message || ""; } catch {}
      throw new Error(details || `Google Drive request failed (${response.status}).`);
    }
    return response;
  }

  function escapedDriveQueryName(name) { return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
  async function findFile() {
    const configured = window.THUNDERSHADOW_CONFIG?.driveFileName || "ThunderShadow.sync.json";
    const cachedId = localStorage.getItem(FILE_ID_KEY);
    if (cachedId) {
      const check = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(cachedId)}?fields=id,name,modifiedTime,size`).catch(() => null);
      if (check) return check.json();
      localStorage.removeItem(FILE_ID_KEY);
    }
    const params = new URLSearchParams({ spaces: "appDataFolder", q: `name='${escapedDriveQueryName(configured)}' and trashed=false`, fields: "files(id,name,modifiedTime,size)", pageSize: "10", orderBy: "modifiedTime desc" });
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
      method: "PATCH", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(payload)
    });
    return response.json();
  }

  async function createFile(payload) {
    const name = window.THUNDERSHADOW_CONFIG?.driveFileName || "ThunderShadow.sync.json";
    const metadataResponse = await driveFetch(`${DRIVE_API}/files?fields=id,name,modifiedTime,size`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ name, parents: ["appDataFolder"], mimeType: "application/json", appProperties: { app: "ThunderShadow", format: "browser-sync-v1" } })
    });
    const metadata = await metadataResponse.json();
    localStorage.setItem(FILE_ID_KEY, metadata.id);
    return uploadMedia(metadata.id, payload);
  }

  async function syncNow({ background = false } = {}) {
    if (!isAuthorized()) {
      setState(localStorage.getItem(ENABLED_KEY) === "1" ? "reauth" : "disabled", localStorage.getItem(ENABLED_KEY) === "1" ? "Reconnect Google Drive to resume cloud sync. Local browser saving is unaffected." : "Google Drive sync is not enabled.");
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
    syncTimer = setTimeout(() => { if (document.visibilityState === "visible") syncNow({ background: true }).catch(() => {}); }, 1800);
  }

  async function disconnect() {
    clearTimeout(syncTimer);
    const token = accessToken;
    accessToken = ""; tokenExpiry = 0; tokenClient = null;
    sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(ENABLED_KEY); localStorage.removeItem(FILE_ID_KEY);
    if (token && window.google?.accounts?.oauth2?.revoke) await new Promise((resolve) => google.accounts.oauth2.revoke(token, () => resolve()));
    setState("disabled", "Google Drive sync disconnected. ThunderShadow continues using browser storage only.");
  }

  function saveClientId(value) {
    const cleaned = String(value || "").trim();
    if (cleaned) localStorage.setItem(CLIENT_ID_KEY, cleaned); else localStorage.removeItem(CLIENT_ID_KEY);
    tokenClient = null;
    setState(localStorage.getItem(ENABLED_KEY) === "1" ? "reauth" : "disabled", cleaned ? "OAuth client ID saved. Connect Google Drive when ready." : "OAuth client ID cleared. Browser storage remains active.");
  }

  function bindDom() {
    const connectBtn = document.getElementById("driveConnectBtn");
    const syncBtn = document.getElementById("driveSyncNowBtn");
    const disconnectBtn = document.getElementById("driveDisconnectBtn");
    const saveBtn = document.getElementById("saveGoogleClientIdBtn");
    const input = document.getElementById("googleClientIdInput");
    connectBtn?.addEventListener("click", () => connect().catch((error) => window.ThunderShadowApp?.showToast?.(error.message)));
    syncBtn?.addEventListener("click", () => syncNow({ background: false }).catch((error) => window.ThunderShadowApp?.showToast?.(error.message)));
    disconnectBtn?.addEventListener("click", () => disconnect().catch((error) => window.ThunderShadowApp?.showToast?.(error.message)));
    saveBtn?.addEventListener("click", () => { saveClientId(input?.value); window.ThunderShadowApp?.showToast?.("Google OAuth client ID saved in this browser."); });
    if (input) input.value = effectiveClientId();
    updateDom();
  }

  function initialize() {
    bindDom(); emit();
    if (isAuthorized()) setTimeout(() => syncNow({ background: true }).catch(() => {}), 700);
    addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && isAuthorized() && Date.now() + 60_000 < tokenExpiry) scheduleSync(); });
  }

  window.ThunderShadowDrive = { initialize, connect, disconnect, syncNow, scheduleSync, getStatus, isAuthorized, saveClientId };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})();
