# HANDOFF — Import form log TSV

Short working log for the TSV-import feature. Project-wide facts live in `AGENTS.md` (see "Form-log TSV import").

- Repo: `dawnsommer/ThunderShadow`, cloud clone at `/home/user/ThunderShadow`, branch `claude/fervent-pasteur-oo1wne`.
- Hosting: GitHub Pages serves the repo root from `main` (no workflow, no build). Live: `https://dawnsommer.github.io/ThunderShadow/`. Pushing `main` deploys.
- Data: browser-only. IndexedDB `ThunderShadowBrowserDB` (`forms` embeds `entries`; `rules`, `settings`, `backups`, `meta`), localStorage emergency fallback, optional Google Drive sync. No data in the repo, so the importer writes through the in-page API (`js/browser-api.js`).

## What exists (release 22.0.7, build 50)

- `js/tsv-import.js`: parser (inverse of `formToTsv`).
- `js/browser-api.js`: `POST /api/import/form-tsv/preview`, `/commit` (modes `new`/`merge`/`replace`, safety snapshot first), `/undo`.
- `js/import-ui.js` + `#tsvImportDialog` in `index.html` + section 13 of `css/redesign.css`: Import TSV button, empty-state action, drag-and-drop, preview, Merge/Replace choice, Undo toast.
- Tests: `test/import.test.mjs` (+ fixture `test/fixtures/step-simulator-sample.tsv`, the user's real Step Simulator export).

## Verify

```bash
node --test test/updates.test.mjs test/import.test.mjs
node tools/release.mjs --check
python3 -m http.server 8765 --bind 127.0.0.1
```

## Status

- [x] Design, parser, API, UI, tests, local browser check (desktop dark/light, 390px Touch).
- [x] Release metadata regenerated, AGENTS.md/README updated.
- [x] Committed and pushed to the branch; fast-forwarded `main` to deploy (user asked to deploy).
- Known limits: tabs inside notes and literal `<br>` text don't round-trip (export limitation). Undo lives in memory for 60 min and covers only the latest import of a form; after that, restore the `safety-before-tsv-import` snapshot in Settings → Data & backups.
- Not verified: native Safari/iPad, Drive sync of imported forms, the live Pages site after deploy.
