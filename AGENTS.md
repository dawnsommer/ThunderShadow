# ThunderShadow project handoff

Last refreshed: 2026-09-30. Read this before changing the project. Source code and the current `git diff` override this summary if they disagree.

## Snapshot

- Current release: `21.0.0-card-browser` (`VERSION`).
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
- `css/styles.css`: all theming/layout; later version blocks override earlier rules. It includes touch v12-v16, rain control v18, desktop optimization v18.6, the v19.1 compact rule-deck/review surfaces, v19.2 review/library refinements, v20 note tags/readable copy/three-column desktop form cards, v20.1 compact Settings categories, v20.2 phone navigation/review layout and compact desktop review toolbar, v20.3 review text scaling, and v20.4 five-row form grids, compact desktop frequency lists/text-size settings, two-sided pattern-kind switching, form-scoped Rule Library sections, and phone Suspend placement; v21 adds the selectable card browser, bulk operations, exam review sessions, visible form scrolling, and iPad refinements. Preserve ordering when editing overrides.
- `js/theme-init.js`: applies theme/UI/rain attributes before paint.
- `js/uuid.js`: UUID helper with Web Crypto fallback.
- `js/config.js`: public cloud coordinates only (app ID, Worker URL, return URL, Drive scope); never put secrets here.
- `js/reasoning.js`: canonical 7 reasoning patterns, 6 speed flags, and legacy-value migration.
- `js/analytics.js`: frequencies, recurrence/trends, predefined combinations, duplicate similarity, and review scheduling.
- `js/browser-api.js`: authoritative local persistence, validation, merge engine, backups/encryption/exports, and in-page `/api/*` `Response` router.
- `js/sync.js`: thin local mutation/draft/status adapter retained for the UI; it does not provide a network outbox or real conflict queue.
- `js/app.js`: core form/logger UI, autosave, keyboard/touch controls, primary-view lifecycle, theme/rain/scale, JSON backup/restore, and service-worker registration.
- `js/v3.js`: rule library, search/tag editing, analytics, bulk card actions, selected exam review sessions, filtered daily reviews/keyboard ratings, partitioned settings, device-local review text sizing, snapshot restore, encrypted portable backup, and exports.
- `js/cloud-sync.js`: optional Cloudflare Worker OAuth plus Google Drive `appDataFolder` synchronization.
- `service-worker.js`: shell cache only; network-first navigation/code, cache-first other same-origin assets. It never performs cloud sync.
- `manifest.json` and `manifest.webmanifest`: identical relative-scope PWA manifests; keep both for compatibility.
- `privacy.html`: public privacy policy. `assets/`: SVG and 180/192/512 PNG icons.

Script dependency order in `index.html` is significant: `config` → `reasoning` → `analytics` → `browser-api` → `sync` → `app` → `v3` → `cloud-sync`. `theme-init` and `uuid` load in `<head>`.

## Data and behavior

IndexedDB is the immediate source of truth. Database `ThunderShadowBrowserDB`, schema version 1, stores:

- `forms`: metadata plus embedded `entries`/compatibility alias `questions`.
- `rules`: saved canonical rules, aliases, review history, status, notes, and source pointers.
- `settings`: synced desktop `ui_scale` and the four review intervals (`again`, `hard`, `good`, and `easy`, in days), plus configurable `review_shortcuts`.
- `backups`: verified full JSON snapshots (14 retained; scheduled at most every 24 hours during idle time).
- `meta`: tombstones and backup timestamps.

Entries have stable monotonic `entryNumber`, error code 1-7, one canonical reasoning pattern, zero or more speed flags, study note (`reasoningNote` / compatibility alias `manualRule`), `noteKind` (`clinical` or `reasoning`), deterministic `noteId` (`<form-id>:entry-<number>`), soft-delete state, revision, and timestamps. Forms and entries are normalized defensively for old backup/Drive shapes. Permanent form/rule/entry deletions create timestamped tombstones so another device cannot resurrect them.

Storage resilience is deliberate: IndexedDB opens time out after 3.5 seconds and transactions after 6.5 seconds; failure switches to a new recovery database without deleting the original. If recovery also fails, `localStorage` emergency stores keep forms/rules/settings/meta working. Full browser snapshots are disabled in emergency mode to avoid quota exhaustion. Recovery clears the cloud dirty ledger and cached Drive index so an empty fallback store cannot be uploaded as authoritative deletion.

Device-only `localStorage` preferences include theme, desktop/touch UI, rain on/off, phone section expansion, review text size (`thundershadow:review-text-size`), drafts, lightweight form cache, recovery markers, and cloud/session metadata. Desktop scale, review intervals, and review shortcuts are included in synced settings. Do not put OAuth/session values in exports, backups, logs, or Drive objects.

Core browser-API families: forms and entries CRUD/restore/permanent delete/TSV; JSON backup and destructive restore; browser snapshots/list/preview/download/restore; encrypted `.tsbackup` export/import preview; analytics; rules/merge/review/selected-review/suspend/delete; longitudinal TSV, active-rules TSV, analytics JSON, ChatGPT-analysis Markdown; settings. Restore is intentionally destructive after validation and creates a safety snapshot first. Portable archives use PBKDF2-SHA-256 (240,000 iterations) plus AES-256-GCM; passphrases are never stored.

UI guarantees: desktop scale 80-120%; explicit Desktop/Touch modes; light/dark/system themes; device-local rain toggle; phone uses `visualViewport`, safe areas, one renderable primary view, an internal logger scroll surface, persistent optional-section preferences, and phone-native analysis tables. Wide Desktop form-library cards use three columns and five compact rows in the available grid height (compact portrait tablets use two columns) (additional rows scroll; very short windows retain a 90px row minimum), with readable supporting copy and complete internal-analysis counters. The header display-mode control uses target-specific tablet/desktop icons. The header title includes a “by Bladelord” byline without a subtitle. Study notes use a two-sided Clinical Pattern / Broad Pattern switch in the logger. Both kinds retain and display the same optional reasoning patterns, error codes, and speed flags; only the perspective differs. Stored `noteKind` values remain `clinical` / `reasoning` for backup and Drive compatibility. Rule identity and duplicate detection include the selected pattern for both kinds. The Rule Library shows one accessible section at a time: Saved rules, Rules found in logs, or Suspended rules. Each section remembers kind and form filters. All Rules / Clinical Pattern / Broad Pattern tabs precede an All forms/form strip with a visible scrollbar and mouse scroll buttons. All tab groups support arrows/Home/End. Sort by due date, P1–P7 then no pattern, kind, source, or wording. Compact saved/suspended rows have checkboxes, All shown, Clear, and Shift-click range selection; expanding exposes full editing/history. Selections persist across filters with an explicit hidden count, and clear on section changes. Bulk actions suspend/resume, make due today, or change kind/pattern. Edits preserve history, dates, notes, and sources; Resume preserves due dates, and Due today preserves suspension. Existing duplicate validation leaves failed cards unchanged and selected; controls remain disabled through saving and list refresh. Filtering includes direct sources and all occurrences, including coalesced unsaved notes across forms. Search covers wording/tags/patterns/source forms. Bulk import applies only to visible kind/form/search candidates. Saved cards retain source form/name/entry/note IDs; both log and active-rule TSVs include note type and provenance. The Active Rules suspended-rules button opens the Rule Library at its suspended section while keeping the app header and navigation in place. Active Rules presents one due card at a time, preserves authored line breaks in rule and note text, and schedules Again/Hard/Good/Easy directly from the four intervals configured in Settings. Desktop review shows the source form/entry, occurrences, last-seen date, and Suspend at the top of each card; Source & details is reserved for phone/compact-landscape Touch layouts. Desktop review places the heading, card filters, due count, and suspended-rules control on one row, omits introductory copy and rating-key labels, and shows the source beside Suspend in the card top bar; the desktop card uses the remaining height with a 28px bottom inset, internal text scrolling, and ratings at the bottom; phone review uses slightly smaller main card text. Review filters select All cards, Broad Patterns, or Clinical Patterns. Default review keys are 1/2/3/4 for Again/Hard/Good/Easy plus Space for Good; keys are editable and synced through Settings, and ignore typing/modifiers/repeats. Logger shortcuts: `1-7` error code, `Shift+0-7` pattern, `Alt/Option+0-6` speed flags, `[`/`]` navigation, `Cmd/Ctrl+Enter` save-next, and selected-code copy with `Cmd/Ctrl+C`.

Exam review: Review selected opens Active Rules with the selected active IDs in library sort order, ignoring due dates and the daily queue's 30-card page limit. POST `/api/rules/review-selection` reads current hydrated records without mutations, excludes missing/suspended cards, deduplicates IDs, and preserves ID order. Rating saves existing history/scheduling and removes that ID from the session; suspension also removes it. Kind filters narrow the session, and Return to daily review exits it. The session (`ids`, `reviewed`) lives only in `sessionStorage` at `thundershadow:selected-review`, survives same-tab reloads, and is excluded from backups/cloud. Queue loads clear stale rating controls and use the existing load-generation guard.

Both UI modes adapt to iPad portrait/landscape. Desktop tablets avoid fixed minimum grid widths; compact landscape uses two logger choice columns and the study note below, with content-height rows and internal scrolling. Touch review contains the card body and keeps ratings at the bottom on large tablets as well as phones. All Touch sizes retain the area navigation while logging. Privacy stays linked in Settings; the document footer is hidden to prevent focus-induced scrolling of app chrome.

Phone chrome shows the complete ThunderShadow title and all five primary tabs without horizontal scrolling, including while logging. The expanded entry navigator uses one column and wraps form names. Phone/compact-landscape review fills the remaining viewport: only card text/details scroll, while Again/Hard/Good/Easy stay in a bottom rating dock with configured intervals. Tags remain visible at the card top; a compact 28px Suspend pill sits at the top-right beside the tags; source/history live under Source & details. Review focus follows the next card; shortcuts preserve normal navigation/details control keys. Rating saves disable controls until completion.

Settings uses accessible tabs for **Review cards**, **Interface**, and **Data & backups**, retaining the selected category while the app stays open. Desktop uses paired compact cards; Card text size occupies one column with a smaller preview. Phone stacks cards with larger controls. Review cards includes a live 80–140% text-size slider in 5% steps (default/Reset 100%), with a preview. It saves automatically under `thundershadow:review-text-size`, scales review wording and authored notes on desktop and phone, and stays outside synced settings, backups, and exports. Interface includes a synced Desktop scale selector. Sync details and saved snapshots expand on demand. Existing backup preview/restore confirmations remain required.

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

Current cache release is `thundershadow-github-shell-v38`; both the shell and `index.html` use code/style query key `?v=38`. JSON package version is 7; versions 1–6 remain accepted, with IndexedDB schema version 1 unchanged.

Settings shows “Upgrade notes” only when older metadata remains. The idempotent upgrade creates a safety snapshot when IndexedDB is available, fills note tags/IDs and exact-match source links, and preserves rule IDs, wording, review history, and due dates. Older patterned notes default to Broad Patterns; unpatterned notes default to Clinical Patterns. Explicit kind selections and existing patterns remain intact. Unknown/deleted sources remain unavailable instead of being guessed. Local note saves are serialized and keep newer edits/drafts when an older save completes.

Current verification: JavaScript syntax, both JSON manifests, manifest equality, shell-asset existence, static DOM targets, unique HTML IDs, and `git diff --check` pass. Isolated synthetic browser checks cover a 96-card deck plus duplicate cases: multi-selection/Shift-click, hidden selections, kind/form tabs, mouse scrolling, keyboard tabs, pattern sorting, bulk due/suspend/resume/pattern/kind actions, failure selection retention, a 90-card selected queue across reloads, keyboard ratings, filtered completion, and return to daily review. Responsive checks cover 768×1024, 1024×768, and 1194×834 in both UI modes, 1440×900 Desktop, Desktop scale to 120%, and 320px/390px Touch plus compact landscape at 140% text with reachable ratings. A temporary Node VM check verifies selected queues beyond 30, stable order/deduplication, no queue-entry mutation, missing/suspended exclusions, input validation, history/date/source preservation through edits, suspension/resume/due/rating behavior, duplicate rejection, dirty-ledger events, and backup roundtrip. These are isolated checks, not a committed suite. Cloud/OAuth, multi-device merge, native iPad Safari, and production deployment were not reverified.

There is no automated integration suite after the server removal. The conflict dialog and `handleServerEvent` compatibility paths remain in the UI, while `js/sync.js` conflict/pending methods are no-ops; do not describe them as active multi-client conflict UI without implementing and testing that behavior.

## Handoff maintenance

After every meaningful project change, update this file in place rather than creating a dated report:

1. Change the refresh date/version only when applicable.
2. Update the relevant file/data/cloud/UI section and current cautions.
3. Record only durable current facts; remove superseded facts instead of appending a release diary.
4. Keep commands runnable and the document compact. Do not paste diffs or implementation narratives.
5. End work with `git status --short`, relevant static checks, and a note of any manual/browser/cloud verification not performed.
