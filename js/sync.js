(() => {
  "use strict";

  const DRAFT_PREFIX = "thundershadow:draft:";
  const CACHE_PREFIX = "thundershadow:cache:";
  const CLIENT_KEY = "thundershadow:browser-client-id";
  const uuid = window.ThunderShadowUUID;
  let flusher = null;
  let lastSyncedAt = null;
  let clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) { clientId = uuid(); localStorage.setItem(CLIENT_KEY, clientId); }

  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
  function entityKey(entity) {
    if (!entity) return "";
    if (entity.type === "entry") return `entry:${entity.formId}:${entity.entryNumber}`;
    if (entity.type === "entry-allocation") return `entry-allocation:${entity.formId}:${entity.provisionalEntryNumber || ""}`;
    return `${entity.type}:${entity.formId || entity.id || ""}`;
  }
  function draftKey(entity) { return `${DRAFT_PREFIX}${entityKey(entity)}`; }
  function saveDraft(entity, value) { if (entityKey(entity)) localStorage.setItem(draftKey(entity), JSON.stringify({ entity, value, savedAt: new Date().toISOString() })); }
  function getDraft(entity) { try { return JSON.parse(localStorage.getItem(draftKey(entity)) || "null"); } catch { return null; } }
  function clearDraft(entity) { if (entityKey(entity)) localStorage.removeItem(draftKey(entity)); }
  async function setCache(key, value) { localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({ value, updatedAt: new Date().toISOString() })); }
  async function getCache(key) { try { return JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${key}`) || "null")?.value ?? null; } catch { return null; } }

  async function updateStatus(forceState = null) {
    const cloud = window.ThunderShadowFirebase?.getStatus?.();
    const dirty = Boolean(window.ThunderShadowFirebase?.getDirtyState?.().dirty);
    const state = forceState || (cloud?.state === "syncing" || dirty ? "pending" : ["error", "offline", "signedout", "unconfigured"].includes(cloud?.state) ? "offline" : "synced");
    const detail = { state, pending: state === "pending" ? 1 : 0, conflicts: 0, lastSyncedAt: cloud?.lastSyncedAt || lastSyncedAt, storage: "browser", cloudState: cloud?.state || "signedout" };
    emit("thundershadow-sync-status", detail);
    return detail;
  }

  async function mutate(path, { method = "PUT", body, entity = null } = {}) {
    const response = await window.ThunderShadowBrowserApi.request(path, { method, body: body == null || typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    let payload = null;
    if (response.status !== 204) payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || `Save failed (${response.status})`);
    lastSyncedAt = new Date().toISOString();
    if (entity) clearDraft(entity);
    await updateStatus();
    return { data: payload, queued: false, conflict: false };
  }

  async function replay() {
    if (flusher) await flusher().catch(() => {});
    if (window.ThunderShadowFirebase?.isAuthorized?.()) await window.ThunderShadowFirebase.syncNow({ background: false, reason: "retry-sync" }).catch(() => {});
    return updateStatus();
  }
  async function resolveConflict() { return null; }
  async function hasPendingEntity() { return false; }
  async function hasPendingForForm() { return false; }
  function initialize() {
    updateStatus();
    addEventListener("thundershadow-firebase-status", () => updateStatus());
    addEventListener("thundershadow-local-data-changed", () => updateStatus());
    addEventListener("online", () => updateStatus());
    addEventListener("offline", () => updateStatus());
  }

  window.ThunderShadowSync = {
    initialize, mutate, replay, resolveConflict, hasPendingEntity, hasPendingForForm,
    setCache, getCache, updateStatus, saveDraft, getDraft, clearDraft, uuid, clientId,
    setFlusher(callback) { flusher = callback; }
  };
})();
