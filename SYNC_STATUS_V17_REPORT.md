# ThunderShadow v17 — Sync Status Regression Fix

## Regression fixed
The header synchronization indicator no longer depends only on the relayed `thundershadow-sync-status` event. It now also renders directly from `thundershadow-cloud-status`, refreshes on `DOMContentLoaded` and `pageshow`, and re-reads the cloud snapshot after app initialization.

## UI behavior
- Desktop: full labels remain visible at every supported app scale, including 115% and 120%.
- Touch: the header indicator shows a compact text label (`Local`, `Connecting`, `Ready`, `Syncing`, `Synced`, or `Offline`) beside the colored dot.
- The title/ARIA label contains the full state and last successful Drive sync time when available.
- Retry is shown only for an actual offline/error state.

## Scope
No IndexedDB schema, Google Drive payload format, OAuth flow, backup/restore format, analytics, or logger data behavior was changed.
