# ThunderShadow GitHub Pages deployment checklist

- [ ] Upload the ZIP contents so `index.html` is at repository root.
- [ ] Do not upload the old Node `data/` directory, SQLite DB, `.env`, or secrets.
- [ ] Enable GitHub Pages from `main` / root.
- [ ] Open the published site and create a small test form.
- [ ] Refresh the page and confirm the test form remains.
- [ ] Export the test form TSV.
- [ ] Export a JSON backup and verify it downloads.
- [ ] On iPad, add the site to the Home Screen and select Touch UI if preferred.

Optional Drive:

- [ ] Enable Google Drive API in a Google Cloud project.
- [ ] Create an OAuth Web Client ID.
- [ ] Add `https://YOUR-USERNAME.github.io` as an Authorized JavaScript origin (plus custom-domain origin if used).
- [ ] Put the Client ID in `js/config.js` or save it in ThunderShadow Settings.
- [ ] Click Connect Google Drive and authorize `drive.appdata` access.
- [ ] Use Sync now once and confirm the UI reports Drive synchronized.
- [ ] Test on the second device/browser by connecting the same Google account and syncing.
