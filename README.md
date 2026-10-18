# ThunderShadow

ThunderShadow is a static, installable, local-first PWA for rapid NBME/CMS error logging, reasoning rules, review, analytics, and exports. It has no build step or application server.

## Study notes and daily review

The logger has a two-sided **Clinical Pattern / Broad Pattern** switch beside its study note. Clinical Patterns capture clinical cues and clinical reasoning; Broad Patterns capture broader question-solving skills. Both use the same error codes, optional reasoning patterns, and speed flags. Switching kind preserves those selections. Notes with or without a pattern can be added to the library.

The Rule Library is a compact card browser with three accessible sections: **Saved rules**, **Rules found in logs**, and **Suspended rules**. Filter first by **All Rules**, **Clinical Pattern**, or **Broad Pattern**, then by **All forms** or a form tab. Each section remembers its kind and form filters while the app stays open. The form strip has a visible horizontal scrollbar and left/right buttons for mouse users. Sort by due date, reasoning pattern (P1–P7, then no pattern), kind, source form, or wording. Shared rules appear under every matching form; search covers wording, notes, tags, patterns, and source forms. Section, kind, and form tabs support arrow keys, Home, and End.

Saved and suspended rows have checkboxes, with **All shown**, Clear, and Shift-click range selection. Selections survive kind/form/search changes; the toolbar explicitly counts selected cards hidden by filters. Switching library section clears the selection. Bulk actions can **suspend**, **resume**, **make due today**, **change reasoning pattern**, or **change pattern kind**. Pattern/kind edits preserve wording, notes, source links, review history, and due dates. Resume preserves the existing due date; Due today preserves suspension, so resume suspended cards before reviewing them. Duplicate-producing edits leave those cards unchanged and selected, with a result message. Controls stay disabled until local saves and the refreshed list finish. Expand a row for full wording, source links, editing, and review history. Unsaved-note import applies only to notes shown by the current kind/form/search filters.

For exam preparation, select saved cards and press **Review selected**. Active Rules reviews exactly those active cards in the current sort order, including future-due cards, without changing their schedule on entry. Ratings save history and the next due date using your Settings intervals. Kind filters narrow this selection; rating or suspending removes that card from the session. **Return to daily review** restores the ordinary due queue. The selected session survives reloads in the same browser tab through sessionStorage, stays outside backups and Drive sync, and has no 30-card cap. Suspended and deleted cards are excluded.

Active Rules presents one card at a time, preserving authored line breaks and displaying its tag, selected reasoning pattern for either kind, and source form/entry. On desktop, the source form and entry, occurrence details, last-seen date, and Suspend appear at the top of each card. Desktop keeps the Daily review heading, filters, due count, and Suspended rules control on one row, hides introductory copy and rating-key labels, and places the source beside Suspend in the card top bar; the desktop card leaves a small inset below the ratings and keeps its body internally scrollable. On phones, the main card text is slightly smaller to fit the review card. Filter the queue to **All cards**, **Broad Patterns**, or **Clinical Patterns**. Again, Hard, Good, and Easy use the intervals chosen in Settings (defaults: 1, 3, 7, and 30 days). Their default keys are **1, 2, 3, 4**, with **Space** also rating Good. Customize these synced shortcuts in Settings; they do not fire while typing or holding a modifier or repeated key.

The app header shows the ThunderShadow title with a **by Bladelord** byline and no subtitle.

The **Suspended rules** control in Active Rules opens the Rule Library at the suspended section without scrolling the app header or navigation out of view.

On phones, the full ThunderShadow title and all five navigation tabs stay visible, including while logging. Daily review gives the card the remaining screen space and keeps four ratings at the bottom. Long text and notes scroll inside the card; source information expands under **Source & details**, while a compact Suspend pill stays at the top-right beside the kind/pattern tags. Ratings advance directly to the next card, with Good emphasized and each configured interval visible. Keyboard focus follows the card, while navigation and Details keep their normal keyboard behavior. The same layout adapts to compact landscape screens and larger Touch tablets. Both UI modes fit iPad portrait and landscape; compact Desktop tablets use two choice columns with the study note below and an internal logger scroll surface. Touch retains all five navigation tabs while logging on tablets as well as phones. The Privacy Policy is linked in Settings; there is no extra document footer to displace the app chrome.

Each logged note has a stable `<form-id>:entry-<number>` ID. Form and longitudinal TSVs include note type, form ID, and note ID. Active-rules TSV adds the source form, entry, note ID, and all available source occurrences. Settings temporarily offers **Upgrade notes** for older metadata, creating a safety snapshot where IndexedDB is available and recovering exact-match sources while preserving rule IDs, wording, review history, and due dates. Older patterned notes default to Broad Pattern and can be reclassified in the library. Sources that cannot be recovered stay unavailable.

Wide Desktop form cards use three columns and five rows in the available grid height (compact portrait tablets use two columns), with scrolling for additional forms. Very short windows keep a readable minimum card height. The logger library’s four internal-analysis counters share one row on desktop; compact frequency lists keep speed flags visible at standard desktop window sizes. The counters use the same calculation as the Analysis page.

## Logged forms

The **Logger** tab separates **NBME** and **CMS** forms, with counts and an **Other** tab for forms whose type cannot be recognized. The app uses the exam type first and falls back to the form name. Search stays within the selected category; the internal analysis still includes all forms. Tabs support arrow keys, Home, and End and retain your selection while navigating the app.

Forms appear by **recorded form date, newest first**. Latest update time breaks same-date ties, so editing an older exam does not place it above a newer exam. The larger **New form** button beside **Your logged forms** opens the existing form dialog with NBME/CMS preselected from the current tab.

Global header controls keep the same positions across app tabs and open forms, centered on desktop/tablets and compact on phones. While logging, a compact **Previous / Entry X of Y / Next** capsule sits at the top-right on desktop and tablets; Next becomes **New entry** at the end. It leaves the centered controls fixed. Phones retain their native entry navigator. The extra toolbar row above the choices is removed, and Delete/Restore sits beside the Error code heading. Compact descriptions keep all seven error codes visible; hover shows each full definition. Enlarged desktop layouts use two choice columns where needed. New forms are created from the logged-forms view rather than the header.

## Settings

Settings is divided into **Review cards** (intervals, keyboard shortcuts, text size, and legacy note upgrade), **Interface** (display, theme, rain, synced Desktop scale, and phone logger sections), and **Data & backups** (optional Drive sync, encrypted backups, exports, and browser snapshots). Review cards also includes an 80–140% text-size slider in 5% steps with a live preview and Reset to 100%, saved automatically on this device and applied to card wording and notes on desktop and phone. Text size is a browser preference and is excluded from Drive sync and data backups/exports. One category is shown at a time, with paired cards on desktop and stacked cards on phone. The desktop Card text size card occupies one column with a compact preview. Tabs support arrow keys, Home, and End. Sync details and snapshot history expand when needed; restore still starts with a preview and confirmation.

Rain effect **Off** keeps a static background and stops rain, moving clouds, and lightning. The redesigned storm uses a single rain texture at 24 frames per second, a slower cloud bank, and occasional localized lightning, with distinct colors for light and dark themes. It avoids animated blur and blending. Enabled effects stop and release their animated surfaces while the page is hidden. The system’s reduced-motion preference also keeps the storm static in both Desktop and Touch modes.

## Anki export

In **Settings → Data & backups → Anki & study exports**, choose **Export Anki TSV**. It exports every active saved rule, including future-due cards, as one Basic front/back card: Front is the rule wording; Back contains your notes, pattern kind, and source context; Tags identify kind, reasoning pattern, and source forms. Suspended rules are excluded. The separate **Rules data TSV** remains available for general data use.

For reliable repeat imports, the TSV has four columns: **ThunderShadowID / Front / Back / Tags**. The stable ID uses the existing rule ID and survives wording, pattern, and kind edits. Following [Anki’s custom-ID guidance](https://docs.ankiweb.net/importing/text-files.html), set up a note type once in Anki Desktop: clone **Basic** as **ThunderShadow Basic**, add **ThunderShadowID** as its first field, followed by Front and Back, and keep Basic’s Front/Back templates unchanged so the ID stays hidden. The expandable instructions in Settings include the import mapping.

Import with that same note type, Tab separator, HTML enabled, and **Note type** match scope. File headers prefill the format on Anki 2.1.54+. Choose **Update** to refresh existing cards while preserving Anki scheduling, or **Preserve** to skip existing cards; avoid Duplicate. New rule IDs create new cards. This is a one-way content export: ThunderShadow review history/schedules are independent, and later deleting, suspending, or merging rules does not remove their old Anki cards.

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

Current release is `21.2.1-logger-header`; the application shell uses cache/query version `42`. Five-second enabled-storm traces in isolated Chrome Touch/light mode dropped from 300 compositor frames and 900 paints to 120 frames and zero paints; Off remains at zero frames/paints. Light/dark Desktop and phone Touch checks cover On/Off, reload persistence, reduced motion, simulated visibility stop/restart, Anki export download, and no horizontal overflow. The Anki 26.09.3 importer was tested in disposable collections: automatic field mapping, hidden IDs, repeat-import deduplication, edited/new cards, Update/Preserve, formatting/tags, and unchanged Anki scheduling pass; its app import UI was not opened. Whole-device CPU/GPU usage and native background/BFCache behavior were not measured. Current logger checks confirm the top-right capsule, stable centered controls, seven visible error codes across Desktop 100/120% scales and Touch sizes, header navigation/autosave, keyboard commands, Delete/Restore confirmations, and tablet touch targets. Current form-browser checks cover type/name classification, category search and keyboard tabs, date sorting, creation defaults, actual form/note saves, stable header positions across areas/open forms, 120% desktop scale, and scrolling 30 forms. Desktop/Touch layouts were checked at 1440×900, 1194×834, 1024×768, and 768×1024, plus 390px/320px Touch phones. Static checks cover JavaScript syntax, both identical manifests, shell assets, static DOM targets, unique IDs, and whitespace. Isolated browser verification with synthetic cards covers multi-selection and Shift-click, hidden selections, kind/form filters, mouse scroll buttons and keyboard tabs, pattern sorting, bulk due/suspend/resume/pattern/kind actions, duplicate failures, a 90-card selected session across reloads, keyboard ratings, filtered completion, and returning to the daily queue. Responsive checks cover 768×1024, 1024×768, and 1194×834 iPad sizes in both modes, 1440×900 Desktop, Desktop scaling to 120%, and 320px/390px Touch phones plus compact landscape at 140% card text. An isolated API check verifies uncapped selected queues, no mutation on queue entry, suspended/deleted exclusions, duplicate rejection, history/date/source preservation, the dirty ledger, and backup roundtrip. Cloud/OAuth, multi-device synchronization, native iPad Safari, and production deployment were not reverified.

Coding agents and maintainers should read `AGENTS.md` before making changes. It is the compact, current architecture and handoff manifest; update it in place after meaningful changes instead of adding dated report files.
