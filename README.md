# ThunderShadow

ThunderShadow is a static, installable, local-first PWA for rapid NBME/CMS error logging, reasoning rules, review, analytics, and exports. It has no build step or application server.

## Study notes and daily review

The logger has one **Clinical pearl / Reasoning cue** tag beside its study note. Clinical pearls capture knowledge or illness scripts. Click the tag to mark a Reasoning cue linked to the selected reasoning pattern. Notes without a pattern can also be added to the library.

The Rule Library imports all unsaved notes or a selected subset. Saved cards use compact expandable rows with editable tags and patterns, source-form links, and search across wording, notes, tags, and source forms. Suspended cards remain in storage and backups and stay outside daily review.

Active Rules presents one card at a time, preserving authored line breaks and displaying its tag, reasoning pattern when applicable, and source form/entry. On desktop, the source form and entry, occurrence details, last-seen date, and Suspend appear at the top of each card. Desktop keeps the Daily review heading, filters, due count, and Suspended rules control on one row, hides introductory copy and rating-key labels, and places the source beside Suspend in the card top bar; the desktop card fills the remaining window height with a scrolling body and ratings at the bottom. On phones, the main card text is slightly smaller to fit the review card. Filter the queue to **All cards**, **Reasoning cues**, or **Clinical pearls**. Again, Hard, Good, and Easy use the intervals chosen in Settings (defaults: 1, 3, 7, and 30 days). Their default keys are **1, 2, 3, 4**, with **Space** also rating Good. Customize these synced shortcuts in Settings; they do not fire while typing or holding a modifier or repeated key.

The app header shows the ThunderShadow title with a **by Bladelord** byline and no subtitle.

The **Suspended rules** control in Active Rules opens the Rule Library at the suspended section without scrolling the app header or navigation out of view.

On phones, the full ThunderShadow title and all five navigation tabs stay visible, including while logging. Daily review gives the card the remaining screen space and keeps four ratings at the bottom. Long text and notes scroll inside the card; source information and Suspend expand under **Source & details**. Ratings advance directly to the next card, with Good emphasized and each configured interval visible. Keyboard focus follows the card, while navigation and Details keep their normal keyboard behavior. The same layout adapts to compact landscape screens.

Each logged note has a stable `<form-id>:entry-<number>` ID. Form and longitudinal TSVs include note type, form ID, and note ID. Active-rules TSV adds the source form, entry, note ID, and all available source occurrences. Settings temporarily offers **Upgrade notes** for older metadata, creating a safety snapshot where IndexedDB is available and recovering exact-match sources while preserving rule IDs, wording, review history, and due dates. Older patterned notes retain the Reasoning cue tag and can be reclassified in the library. Sources that cannot be recovered stay unavailable.

Desktop form cards use three columns and four rows in the available grid height, with scrolling for additional forms. Very short windows keep a readable minimum card height. Supporting text is larger, and the logger library’s internal-analysis counters use the same calculation as the Analysis page.

## Settings

Settings is divided into **Review cards** (intervals, keyboard shortcuts, and legacy note upgrade), **Interface** (display, theme, rain, synced Desktop scale, and phone logger sections), and **Data & backups** (optional Drive sync, encrypted backups, exports, and browser snapshots). Review cards also includes an 80–140% text-size slider with a live preview and Reset, saved on this device and applied to card wording and notes on desktop and phone. One category is shown at a time, with paired cards on desktop and stacked cards on phone. Tabs support arrow keys, Home, and End. Sync details and snapshot history expand when needed; restore still starts with a preview and confirmation.

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

## Run locally

Serve the repository root over HTTP:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/`. Direct `file://` use is not suitable for service-worker testing.

## Publish on GitHub Pages

1. Publish the repository root from the `main` branch with GitHub Pages.
2. Confirm `index.html`, `service-worker.js`, both manifests, all scripts/styles, and icons are reachable.
3. Production return URL must remain `https://dawnsommer.github.io/ThunderShadow/` unless both the Worker allow-list/configuration and `js/config.js` are intentionally changed.
4. Open ThunderShadow and verify local IndexedDB data before enabling Drive sync.
5. Press **Connect Google**, authorize once, and use **Sync now** for the initial seed/restore.

Cloud configuration is centralized in `js/config.js`. Never add a Google client secret, refresh token, Worker secret, or real user data to this repository.

## Migration from the Firebase release

The new build does not read Firestore. Deploy/connect it first on a device whose IndexedDB contains the current authoritative ThunderShadow data, then allow Drive sync to seed `appDataFolder`. Do not clear that device's IndexedDB until the Drive copy and a second-device restore have been verified.

## PWA/offline

The service worker caches only the application shell. It does not initialize cloud sync or run background synchronization. Cloud initialization/listeners live in the page and are guarded against duplicate registration.

## Maintainer handoff

Coding agents and maintainers should read `AGENTS.md` before making changes. It is the compact, current architecture and handoff manifest; update it in place after meaningful changes instead of adding dated report files.
