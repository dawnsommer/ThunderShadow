# HANDOFF — Import form log TSV

Short working log for the TSV-import feature. Project-wide facts live in `AGENTS.md`.

- Branch: `claude/fervent-pasteur-oo1wne` (cloud clone at `/home/user/ThunderShadow`). Never push `main`, never deploy, no PR until asked.
- Hosting: GitHub Pages serves the repo root from `main` (no workflow files, no build). URL `https://dawnsommer.github.io/ThunderShadow/`.
- Data: browser-only. IndexedDB `ThunderShadowBrowserDB` (`forms` store embeds `entries`; `rules`, `settings`, `backups`, `meta`), localStorage emergency fallback, optional Google Drive sync of the same records. No data files in the repo, so the importer writes through the in-page API in `js/browser-api.js`.
- Format to invert: `formToTsv` in `js/browser-api.js` (13 columns, `ankiTsvCell` quoting, notes `<br>`, pattern/speed as display labels like `P5 — HINGE`).
- Step Simulator draft (`/Users/bladelord/.../_draft_shadow_logger/`) is on the user's Mac and not reachable from this cloud session; working from the spec in the request.

## Status

1. [x] Codebase read, design proposed — **waiting for user approval** before editing code.
2. [ ] Parser + preview/commit/undo API
3. [ ] UI (library button + dialog)
4. [ ] Tests (round trip, simulator TSV), local browser check
5. [ ] AGENTS.md update, commit, push branch
