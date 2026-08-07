# ThunderShadow — GitHub Pages / Browser Edition

This build converts ThunderShadow from a Node/Express/SQLite LAN app into a static, installable browser app that can be hosted directly on GitHub Pages.

## What is preserved

- ThunderShadow visual design, storm background, glass UI, light/dark/system theme, UI scaling, desktop/touch modes, keyboard shortcuts, selection/copy workflow, rule patterns, speed flags, form library, review library, analytics, and exports.
- Form creation/editing, sequential error logging, deleted-entry restore and permanent deletion.
- Per-form TSV export.
- Longitudinal TSV, active-rules TSV, analytics JSON, and ChatGPT-analysis Markdown exports.
- Full JSON backup/import compatible with ThunderShadow JSON backups (versions 1–6).
- Local verified snapshot history in the browser.
- Password-encrypted portable browser backups (`.tsbackup`) using PBKDF2-SHA-256 + AES-256-GCM.
- PWA/offline shell for installation from Safari/Chrome and use on iPad.

The only intentionally removed subsystem is the Mac-hosted LAN/server access model. There is no Node server, SQLite server database, LAN PIN, SSE, or Mac-to-phone synchronization in this edition.

## Storage model

**IndexedDB in the current browser is the authoritative default store.** Every edit is saved locally first, so the app remains usable without Google Drive or internet access.

Because browser storage belongs to a specific browser/site origin, data on one device does not automatically appear on another unless Google Drive sync is enabled or a backup is exported/imported.

ThunderShadow requests persistent browser storage where the browser supports it. You should still keep JSON/encrypted backups or enable Drive sync, especially on mobile devices where the operating system can reclaim site storage under pressure.

## Publish on GitHub Pages

1. Create a GitHub repository, for example `ThunderShadow`.
2. Put the **contents of this ZIP** in the repository root. `index.html` must be at the root.
3. Commit and push to the `main` branch.
4. In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**.
5. Select **main** and **/(root)**, then save.
6. Open the resulting Pages URL.

The PWA paths are relative, so both `https://USERNAME.github.io/ThunderShadow/` and a custom-domain root deployment work.

### iPad

Open the GitHub Pages URL in Safari. For an app-like experience use **Share → Add to Home Screen**. ThunderShadow's Touch UI can be selected from the toolbar/settings; portrait layouts also adapt automatically at mobile/tablet widths.

## One-time migration from the Mac/server edition

Do **not** publish the old `data/` directory or SQLite database to GitHub.

Instead:

1. In the existing Mac ThunderShadow, use its normal **JSON Backup** export.
2. Open the GitHub Pages edition.
3. Use **Restore JSON backup** and select that file.
4. Verify the forms/logs, then create a new browser-edition backup.

JSON backups from prior ThunderShadow versions are supported. Old encrypted SQLite/scrypt `.tsbackup` archives are intentionally not decoded in the static browser build; restore those in the Mac edition first and export JSON.

# Optional Google Drive sync

Drive is optional. Browser IndexedDB remains the local/default store whether Drive is connected or not.

ThunderShadow stores one private sync file named `ThunderShadow.sync.json` in Google Drive's hidden **appDataFolder**. The app asks only for the `drive.appdata` scope, so it cannot browse the user's ordinary Drive documents through this integration.

Sync is bidirectional: before upload, ThunderShadow downloads the Drive package, merges forms/entries/rules/reviews/deletion tombstones, writes the merged result locally, and then uploads the merged package. Local edits debounce into automatic Drive sync while an authorization token is valid.

## Google Cloud setup for the site owner

GitHub Pages is static, so it cannot contain a private OAuth client secret. A public **OAuth 2.0 Web Client ID** is used instead.

1. Create/select a project in Google Cloud Console.
2. Enable **Google Drive API**.
3. Configure the OAuth consent screen.
4. Create **OAuth client ID → Web application**.
5. Add the GitHub Pages origin under **Authorized JavaScript origins**:
   - `https://YOUR-USERNAME.github.io`
   - If using a custom domain, also add its HTTPS origin.
   - Origins do not include the repository path.
6. Copy the Client ID.
7. Either:
   - edit `js/config.js` and put it in `googleClientId` before publishing, **recommended for a finished deployment**, or
   - place the shared ThunderShadow public OAuth Client ID in `js/config.js`. Users only need to click Connect Google Drive and authorize their own account.

Example `js/config.js`:

```js
window.THUNDERSHADOW_CONFIG = Object.freeze({
  googleClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  driveFileName: "ThunderShadow.sync.json"
});
```

The Client ID is not a secret and is expected to be visible in browser source. Do not put a Google client secret, service-account key, or refresh token in this repository.

## Important Google authorization limitation on a pure static site

After the user clicks **Connect Google Drive** and authorizes access, ThunderShadow automatically syncs while that browser authorization token remains valid. It also resumes automatically on reload when the same session token is still valid.

Google's browser token model does **not** provide a refresh token. When the access token has expired and Google requires a new one, the browser must obtain it from a user-triggered action. ThunderShadow therefore changes to **Reconnect Drive** while continuing to save everything locally. One tap restores cloud sync.

Truly unattended long-lived token refresh would require an OAuth authorization-code flow plus a backend that securely stores/uses refresh tokens, which would no longer be a pure GitHub Pages application.

## Backup strategy

Recommended:

- Browser IndexedDB: continuous primary local save.
- Google Drive: optional cross-device/cloud sync.
- JSON backup: periodic portable, human-inspectable backup.
- Encrypted `.tsbackup`: portable confidential archive when you need a password-protected copy.
- Browser snapshot history: convenience recovery inside the same browser profile; do not treat it as the only backup because it is stored in the same site storage.

## Repository contents

- `index.html` — app shell
- `css/styles.css` — original visual system plus Drive settings styling
- `js/app.js` — core UI/workflow
- `js/v3.js` — rules/analytics/review/settings UI
- `js/browser-api.js` — browser replacement for the former server API; IndexedDB, backup, export, merge, encryption
- `js/sync.js` — local-save/Drive-aware sync status adapter
- `js/drive-sync.js` — Google Identity Services + Drive appDataFolder sync
- `js/reasoning.js`, `js/analytics.js` — browser ports of the original server analytics/reasoning modules
- `js/config.js` — deploy-time public configuration
- `service-worker.js`, `manifest.json`, `manifest.webmanifest` — PWA/offline support
- `.nojekyll` — tells GitHub Pages to serve the static files directly


## Public privacy policy

This release includes `privacy.html`. For a public Google OAuth deployment:

1. Publish the site and confirm `privacy.html` is reachable at your production origin.
2. Keep the **Privacy Policy** link visible on the ThunderShadow homepage/settings.
3. In Google Cloud OAuth branding/consent configuration, set the privacy-policy URL to that exact published URL.
4. Keep the policy accurate if ThunderShadow's Google-data usage changes.
5. For production brand verification, use a domain you can verify in Google Search Console; a custom domain mapped to GitHub Pages is the safest deployment model.

## Security/privacy notes

- The original SQLite database and project `data/` directory are **not included** in this static distribution.
- No application data is sent to GitHub; GitHub Pages serves only the static application files.
- Without Drive enabled, user data remains in that browser profile plus any files the user exports.
- With Drive enabled, the ThunderShadow sync package is stored in that user's Drive app-data area.
- The OAuth Client ID is public configuration. Never commit an OAuth client secret.
