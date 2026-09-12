# ThunderShadow project handoff

Last refreshed: 2026-09-12. Read this before changing the project. Source code and the current `git diff` override this summary if they disagree.

## Snapshot

- Current release: `19.1.0-rule-deck-review` (`VERSION`).
- Product: framework-free, static, installable NBME/CMS error-logging PWA deployed from the repository root on GitHub Pages.
- Production URL/OAuth return URL: `https://dawnsommer.github.io/ThunderShadow/`.
- No build step, Node server, package manager, Firebase, Firestore, SQLite, or backend API exists in this edition. The old server files are intentionally deleted.
- Git warning: the repository has only the original server-era baseline commit. The current browser edition is a large, uncommitted working-tree migration. Treat every existing modification, deletion, and untracked source file as user-owned current work; never restore the baseline wholesale.

## Start and verify

Serve the root over HTTP (service workers and module-like browser behavior should not be tested with `file://`):

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. There is no dependency install or test runner. Minimum static checks after changes:

```bash
for file in js/*.js service-worker.js; do node --check "$file"; done
python3 -m json.tool manifest.json >/dev/null
python3 -m json.tool manifest.webmanifest >/dev/null
```

Also confirm every `service-worker.js` shell asset exists, HTML IDs remain unique, all static `getElementById`/`$(...)` targets still exist, and test desktop plus phone Touch UI manually. For cloud changes, test signed-out local use, OAuth return, clean sync, dirty sync, offline edit/reconnect, second-browser restore, deletion propagation, and disconnect.

## Runtime map

- `index.html`: complete app shell, six primary views (form library, logger, rule library, analysis, active-rule review, settings), dialogs, and script load order.
- `css/styles.css`: all theming/layout; later version blocks override earlier rules. It includes touch v12-v16, rain control v18, desktop optimization v18.6, and the v19.1 compact rule-deck/review surfaces. Preserve ordering when editing overrides.
- `js/theme-init.js`: applies theme/UI/rain attributes before paint.
- `js/uuid.js`: UUID helper with Web Crypto fallback.
- `js/config.js`: public cloud coordinates only (app ID, Worker URL, return URL, Drive scope); never put secrets here.
- `js/reasoning.js`: canonical 7 reasoning patterns, 6 speed flags, and legacy-value migration.
- `js/analytics.js`: frequencies, recurrence/trends, predefined combinations, duplicate similarity, and review scheduling.
- `js/browser-api.js`: authoritative local persistence, validation, merge engine, backups/encryption/exports, and in-page `/api/*` `Response` router.
- `js/sync.js`: thin local mutation/draft/status adapter retained for the UI; it does not provide a network outbox or real conflict queue.
- `js/app.js`: core form/logger UI, autosave, keyboard/touch controls, primary-view lifecycle, theme/rain/scale, JSON backup/restore, and service-worker registration.
- `js/v3.js`: rule library, analytics, reviews, settings, snapshot restore, encrypted portable backup, and exports.
- `js/cloud-sync.js`: optional Cloudflare Worker OAuth plus Google Drive `appDataFolder` synchronization.
- `service-worker.js`: shell cache only; network-first navigation/code, cache-first other same-origin assets. It never performs cloud sync.
- `manifest.json` and `manifest.webmanifest`: identical relative-scope PWA manifests; keep both for compatibility.
- `privacy.html`: public privacy policy. `assets/`: SVG and 180/192/512 PNG icons.

Script dependency order in `index.html` is significant: `config` → `reasoning` → `analytics` → `browser-api` → `sync` → `app` → `v3` → `cloud-sync`. `theme-init` and `uuid` load in `<head>`.

## Data and behavior

IndexedDB is the immediate source of truth. Database `ThunderShadowBrowserDB`, schema version 1, stores:

- `forms`: metadata plus embedded `entries`/compatibility alias `questions`.
- `rules`: saved canonical rules, aliases, review history, status, notes, and source pointers.
- `settings`: synced desktop `ui_scale` and the four review intervals (`again`, `hard`, `good`, and `easy`, in days).
- `backups`: verified full JSON snapshots (14 retained; scheduled at most every 24 hours during idle time).
- `meta`: tombstones and backup timestamps.

Entries have stable monotonic `entryNumber`, error code 1-7, one canonical reasoning pattern, zero or more speed flags, reasoning note (`manualRule` is a compatibility alias), soft-delete state, revision, and timestamps. Forms and entries are normalized defensively for old backup/Drive shapes. Permanent form/rule/entry deletions create timestamped tombstones so another device cannot resurrect them.

Storage resilience is deliberate: IndexedDB opens time out after 3.5 seconds and transactions after 6.5 seconds; failure switches to a new recovery database without deleting the original. If recovery also fails, `localStorage` emergency stores keep forms/rules/settings/meta working. Full browser snapshots are disabled in emergency mode to avoid quota exhaustion. Recovery clears the cloud dirty ledger and cached Drive index so an empty fallback store cannot be uploaded as authoritative deletion.

Device-only `localStorage` preferences include theme, desktop/touch UI, rain on/off, phone section expansion, drafts, lightweight form cache, recovery markers, and cloud/session metadata. Only `uiScale` is in the synced package. Do not put OAuth/session values in exports, backups, logs, or Drive objects.

Core browser-API families: forms and entries CRUD/restore/permanent delete/TSV; JSON backup and destructive restore; browser snapshots/list/preview/download/restore; encrypted `.tsbackup` export/import preview; analytics; rules/merge/review/suspend/delete; longitudinal TSV, active-rules TSV, analytics JSON, ChatGPT-analysis Markdown; settings. Restore is intentionally destructive after validation and creates a safety snapshot first. Portable archives use PBKDF2-SHA-256 (240,000 iterations) plus AES-256-GCM; passphrases are never stored.

UI guarantees: desktop scale 80-120%; explicit Desktop/Touch modes; light/dark/system themes; device-local rain toggle; phone uses `visualViewport`, safe areas, one renderable primary view, an internal logger scroll surface, persistent optional-section preferences, and phone-native analysis tables. The rule library can import every unsaved Reasoning Note or a selected subset, displays saved rules as compact expandable rows, and separates suspended rules. Active Rules presents one due card at a time and schedules Again/Hard/Good/Easy directly from the user's four day intervals. Logger shortcuts: `1-7` error code, `Shift+0-7` pattern, `Alt/Option+0-6` speed flags, `[`/`]` navigation, `Cmd/Ctrl+Enter` save-next, and selected-code copy with `Cmd/Ctrl+C`.

## Cloud contract and invariants

Cloud is optional; local saves must never wait for or depend on it.

- Config: app ID `thundershadow`; Worker `https://study-tools-auth-worker.summerofdawn20.workers.dev`; scope `https://www.googleapis.com/auth/drive.appdata`.
- Connect redirects to Worker `/oauth/start` with `app_id`, `return_url`, and persistent device ID. Callback `#cloud-auth=<Worker session>` is stored as `cloudflareWorkerSession` and stripped from the URL immediately.
- Worker `/token` exchanges that session for a short-lived Google access token kept only in memory. `/disconnect` clears the Worker/local session but does not delete local data or Drive files. Google refresh tokens/client secrets remain server-side.
- Drive namespace: `thundershadow-manifest.json`, one `thundershadow-form-<base64url-id>.json` per form, one rule file per rule, and `thundershadow-settings.json`. The manifest carries hashes, schema metadata, device marker, and tombstones.
- Durable local mutations first persist a dirty ledger at `thundershadow:cloud-dirty-state`, then emit `thundershadow-local-data-changed`. Normal sync debounce is 7.5 seconds; destructive/finish/restore events request immediate sync.
- Startup silently refreshes and syncs; clean foreground checks are throttled to 60 seconds; reconnect flushes dirty state. Token/Drive requests time out after 15/20 seconds. First restore reads at concurrency 4.
- Clean sync uses Drive file metadata as a fast path. Hashes skip unchanged writes. One dirty entry updates its containing form file plus manifest.
- Remote data is merged incrementally into live IndexedDB, never via full-store replacement. Forms/entries resolve by timestamps then revisions; rules union aliases/reviews; tombstones win over older records. Remote application emits no local mutation event, preventing an echo loop.

Never weaken these invariants: local-first operation, non-destructive cloud merge, tombstone propagation, no secrets in frontend/data files, no cloud activity in the service worker, and no wholesale database clearing except an explicitly confirmed restore.

## Deployment and current cautions

Publish repository root from `main` with GitHub Pages. If the production path changes, update both Worker allow-list/configuration and `js/config.js`. On Firebase-to-Drive migration, first connect a browser whose IndexedDB is authoritative, seed Drive, then verify a second-browser restore before clearing the first browser.

Current cache release is `thundershadow-github-shell-v26`; both the shell and `index.html` use code/style query key `?v=26`.

There is no automated integration suite after the server removal. The conflict dialog and `handleServerEvent` compatibility paths remain in the UI, while `js/sync.js` conflict/pending methods are no-ops; do not describe them as active multi-client conflict UI without implementing and testing that behavior.

## Handoff maintenance

After every meaningful project change, update this file in place rather than creating a dated report:

1. Change the refresh date/version only when applicable.
2. Update the relevant file/data/cloud/UI section and current cautions.
3. Record only durable current facts; remove superseded facts instead of appending a release diary.
4. Keep commands runnable and the document compact. Do not paste diffs or implementation narratives.
5. End work with `git status --short`, relevant static checks, and a note of any manual/browser/cloud verification not performed.
