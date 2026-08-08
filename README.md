# ThunderShadow — GitHub Pages / Browser Edition

ThunderShadow is a static installable PWA for rapid NBME/CMS error logging, rules, review, analytics, and exports.

## Storage model

**IndexedDB in the current browser is the immediate source of truth.** Every durable user action is saved locally first. The app remains fully usable offline and without Google connection.

Optional cross-device synchronization uses:

- the shared `study-tools-auth-worker` Cloudflare Worker for Google OAuth and token refresh only; and
- Google Drive's hidden `appDataFolder` for user-owned ThunderShadow cloud data.

Firebase Authentication and Cloud Firestore are not used in this release.

## Cloud architecture

```text
ThunderShadow UI
      |
IndexedDB (local-first)
      |
Drive adapter / dirty ledger
      |
Google Drive appDataFolder
      |
Cloudflare Worker (OAuth + token refresh only)
```

The browser persistently stores only the Worker session token (`cloudflareWorkerSession`) needed for silent token refresh. Google access tokens are kept temporarily in memory. Google refresh tokens and client secrets are never stored in the frontend.

## Drive file layout

ThunderShadow uses an app-specific namespace so the same Worker/OAuth client can support future tools safely:

- `thundershadow-manifest.json`
- `thundershadow-form-<encoded-id>.json` (one per form; entries remain embedded as in IndexedDB)
- `thundershadow-rule-<encoded-id>.json` (one per rule)
- `thundershadow-settings.json`

The manifest carries hashes and deletion tombstones. A single entry edit therefore updates only the affected form file plus the manifest rather than rewriting the entire local database.

## Sync behavior

- local saves: immediate IndexedDB
- normal cloud sync: 7.5-second debounce after meaningful durable edits
- important completion/delete/restore events: prompt sync
- startup/reload: silent Worker token refresh, then bidirectional Drive check
- foreground: lightweight remote metadata check when clean; sync only if remote changed
- reconnect: sync pending dirty data; clean reconnect may perform a read/check but does not manufacture writes
- idle/background: no recurring cloud-write timer
- manual **Sync now**: bidirectional merge, with hashes used to skip unchanged files

Remote-applied merges write directly to IndexedDB without emitting a local mutation event, preventing a Drive → IndexedDB → Drive echo loop.

## Conflict/deletion behavior

The existing ThunderShadow merge engine remains in use. It preserves record timestamps/revisions, entry-level merge behavior, rule review/alias merging, and deletion tombstones. Cloud storage changed; the local IndexedDB schema did not.

## Publish on GitHub Pages

1. Put the contents of this ZIP at the repository root.
2. Enable GitHub Pages from the `main` branch root.
3. Production return URL must remain `https://dawnsommer.github.io/ThunderShadow/` unless both the Worker allow-list/configuration and `js/config.js` are intentionally changed.
4. Open ThunderShadow and verify local IndexedDB data before enabling Drive sync.
5. Press **Connect Google**, authorize once, and use **Sync now** for the initial seed/restore.

See `CLOUD_SYNC_SETUP.md` for the exact cloud configuration and flow.

## Migration from the Firebase release

The new build does not read Firestore. Deploy/connect it first on a device whose IndexedDB contains the current authoritative ThunderShadow data, then allow Drive sync to seed `appDataFolder`. Do not clear that device's IndexedDB until the Drive copy and a second-device restore have been verified.

## PWA/offline

The service worker caches only the application shell. It does not initialize cloud sync or run background synchronization. Cloud initialization/listeners live in the page and are guarded against duplicate registration.
