# ThunderShadow v18.1 — Top-bar Sync Now

## Change
- The existing top-bar synchronization status pill now acts as a manual **Sync Now** control.
- Clicking it calls the same `ThunderShadowCloud.syncNow()` path already used by Settings → Sync now.
- No second sync engine or alternate state machine was introduced.
- If Google is not connected, the existing `syncNow()` behavior starts the Google connection flow.
- If a sync is already running, the existing in-flight sync promise is reused, preventing parallel Drive syncs.
- Sync state/text continues to be driven by the existing `thundershadow-cloud-status` events.
- Errors are surfaced through the existing app toast.

## Architecture preserved
- IndexedDB remains the local source of truth.
- Existing Google Drive appDataFolder synchronization is unchanged.
- Existing Cloudflare Worker OAuth/token flow is unchanged.
- Background/debounced sync behavior is unchanged.

## Cache
- Asset query/cache version bumped from v19 to v20 so GitHub Pages/PWA clients receive the updated app script.
