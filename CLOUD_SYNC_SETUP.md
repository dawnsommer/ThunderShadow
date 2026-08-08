# ThunderShadow Cloudflare Worker + Google Drive sync

ThunderShadow uses the existing shared OAuth Worker and Google Drive `appDataFolder`.

## Production configuration

`js/config.js` is already configured for:

- App ID: `thundershadow`
- Worker: `https://study-tools-auth-worker.summerofdawn20.workers.dev`
- Return URL: `https://dawnsommer.github.io/ThunderShadow/`
- Scope: `https://www.googleapis.com/auth/drive.appdata`

Do not add a Google client secret or refresh token to this repository.

## Authentication flow

1. User presses **Connect Google**.
2. ThunderShadow redirects to the Worker's `/oauth/start` endpoint with `app_id`, `return_url`, and a persistent `device_id`.
3. After Google authorization, the Worker redirects back with `#cloud-auth=<session_token>`.
4. ThunderShadow stores that Worker session as `cloudflareWorkerSession`, immediately removes it from the URL, and requests short-lived Drive access tokens from `POST /token` as needed.
5. Google refresh tokens remain on the Worker side and are never stored in browser storage.

## Drive layout

Files are stored only in the hidden Drive `appDataFolder` namespace for `app_id=thundershadow`:

- `thundershadow-manifest.json` — hashes, tombstones, schema metadata, device revision marker
- `thundershadow-form-<id>.json` — one file per form, including its embedded entries
- `thundershadow-rule-<id>.json` — one file per rule
- `thundershadow-settings.json` — durable synced settings

This layout avoids rewriting the whole IndexedDB export for a one-entry edit.

## Local-first behavior

IndexedDB remains authoritative for immediate app operation. Durable user changes are saved locally first, persisted in the dirty ledger, then synchronized after a 7.5-second debounce. Major completion/delete/restore events can synchronize immediately. Offline/cloud failures never block local saves.

## Disconnect

Disconnect calls Worker `POST /disconnect`, clears the local Worker session, temporary access token, and connected-account state. It does not delete IndexedDB or Drive app-data files.
