# ThunderShadow GitHub Pages deployment checklist

- [ ] Upload this build so `index.html` is at repository root.
- [ ] Do not upload old Node data, SQLite DBs, `.env`, Firebase credentials/rules, or secrets.
- [ ] Confirm `js/config.js` uses `appId: "thundershadow"`, the shared Worker URL, and the production return URL.
- [ ] Enable GitHub Pages from `main` / root.
- [ ] Open the published site and verify existing IndexedDB data is present on the migration device.
- [ ] Create/edit one test entry and refresh; confirm it remains locally.
- [ ] Press **Connect Google** and complete Google authorization once.
- [ ] Confirm the returned `#cloud-auth=...` fragment disappears immediately from the address bar.
- [ ] Press **Sync now** and confirm the UI reports synchronized.
- [ ] Reload/close/reopen; confirm no repeated Google login popup is required.
- [ ] Disable network; confirm edits still save locally and status becomes pending/offline.
- [ ] Re-enable network; confirm pending changes sync.
- [ ] On a second device/browser, connect the same Google account and verify Drive data restores into IndexedDB.
- [ ] Disconnect Google and confirm local data remains and Drive files are not deleted.
