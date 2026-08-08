# ThunderShadow v11 Cloudflare Worker + Google Drive migration report

## Before migration

### Firebase architecture found

- `js/firebase-sync.js` dynamically loaded Firebase App/Auth/Firestore SDK modules.
- Firebase Auth used Google sign-in, persistent auth state, and an iOS/iPad redirect fallback.
- Firestore stored per-user `forms`, `entries`, `rules`, and `sync/meta` documents.
- The v10.1 optimization already used a persisted dirty ledger and 7.5-second debounce and skipped unchanged Firestore documents.
- `js/config.js`, `index.html`, `js/sync.js`, `service-worker.js`, `FIREBASE_SETUP.md`, and `firestore.rules` also contained Firebase-specific configuration/UI/deployment behavior.

### IndexedDB architecture found

IndexedDB remains unchanged:

- `forms` — form records with entries/questions embedded
- `rules`
- `settings`
- `backups`
- `meta` — including deletion tombstones

`js/browser-api.js` is the local persistence/API layer. Durable mutations save IndexedDB first and then emit `thundershadow-local-data-changed` after persisting a local dirty ledger.

### Migration risks

- Firestore data is not automatically imported by the new build; the migration device must have the current authoritative IndexedDB copy before first Drive seeding.
- The existing tombstone/timestamp merge behavior had to remain intact so another device cannot resurrect deleted forms/rules/entries.
- The shared OAuth client means Drive app-data must be namespaced by `app_id` to prevent future apps such as `exam-simulator2` from mixing data.
- OAuth callback/session values must never enter exports, Drive files, UI text, or debug logs.

## After migration

### Firebase components removed/replaced

Removed:

- `js/firebase-sync.js`
- `FIREBASE_SETUP.md`
- `firestore.rules`
- Firebase Web App configuration and Google direct OAuth client configuration
- Firebase SDK loading, Auth state listener, Firestore reads/writes, and Firebase UI identifiers

Replaced by `js/cloud-sync.js` and centralized Worker/Drive configuration in `js/config.js`.

### Worker integration

Configured:

- Worker: `https://study-tools-auth-worker.summerofdawn20.workers.dev`
- `app_id=thundershadow`
- Return URL: `https://dawnsommer.github.io/ThunderShadow/`
- Scope: `https://www.googleapis.com/auth/drive.appdata`

Connect redirects to `/oauth/start` with `app_id`, `return_url`, and one persistent local device ID.

The callback consumes `#cloud-auth=<session_token>`, stores it as `cloudflareWorkerSession`, and immediately removes the fragment with `history.replaceState()`.

`getValidDriveAccessToken()` calls Worker `POST /token` with the Worker session Bearer token. Google access tokens remain in memory only. No refresh token or client secret is stored in the frontend.

Disconnect calls Worker `POST /disconnect`, clears local Worker/access-token/account state, and leaves IndexedDB and Drive files intact.

### Google Drive sync architecture

Only Drive `appDataFolder` is used. Files are namespaced to ThunderShadow:

- `thundershadow-manifest.json`
- `thundershadow-form-<encoded-id>.json` — one file per form (entries remain embedded, matching IndexedDB)
- `thundershadow-rule-<encoded-id>.json` — one file per rule
- `thundershadow-settings.json`

The manifest stores hashes, schema metadata, device marker, and deletion tombstones. Hashes skip unchanged file uploads. A normal entry edit therefore writes only the affected form file plus the manifest rather than a monolithic database snapshot.

### Dirty state / sync behavior

- IndexedDB save happens before cloud notification.
- Persisted dirty ledger key: `thundershadow:cloud-dirty-state`.
- The previous `thundershadow:firebase-dirty-state` value is migrated once so pending changes are not lost during upgrade.
- Standard debounce: 7.5 seconds.
- Major events already marked `immediate` by `browser-api.js` continue to request prompt sync.
- Startup silently refreshes Drive access and performs a bidirectional check.
- Clean foreground events perform only a throttled remote metadata/list check and do not upload if remote state is unchanged.
- Network restoration synchronizes dirty data; a clean reconnect can check remote state without manufacturing writes.
- Service worker contains no cloud initialization or background sync logic.
- Cloud listener initialization is guarded against duplicate registration.

### Remote echo prevention

Remote Drive records are fed through `ThunderShadowBrowserApi.mergePackage()`. That merge writes IndexedDB directly and does not emit a local mutation event. Remote file hashes from the manifest are then compared to the merged local representation; identical remote-applied data is skipped rather than uploaded back.

### IndexedDB / schema changes

No IndexedDB object store or database-version migration was introduced. `settingsUpdatedAt` was added to the serialized cloud/backup package metadata so settings can participate in deterministic cross-device merge without changing the IndexedDB schema.

## Verification performed

- All project JavaScript and service-worker files pass `node --check`.
- Both web manifests parse as JSON.
- Every service-worker cached local asset exists.
- Static assertions verify Worker URL, app ID, return URL, Drive scope, OAuth callback stripping, session key, `/token`, `/disconnect`, `appDataFolder`, persistent dirty state, and removal of Firebase runtime loading.
- Stateful mocked Worker/Drive acceptance tests verified:
  - existing Worker session reload causes zero Google authorization redirects;
  - initial empty Drive seed creates only settings + manifest;
  - clean manual sync performs 0 Drive writes;
  - one dirty form/entry edit performs 2 Drive writes (affected form + manifest);
  - a remote-only form update merges locally and causes 0 echo writes;
  - offline sync attempts cause 0 Drive writes and preserve authorization/local data;
  - disconnect clears the Worker session without changing the local package.

The sandbox could not resolve the live Worker hostname, so the actual production Worker/Google authorization round trip was not executed here. The integration uses the endpoint/query/header contract specified for the already-tested Worker.
