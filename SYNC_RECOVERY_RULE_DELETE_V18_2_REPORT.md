# ThunderShadow v18.2 — Sync Recovery + Rule Delete

## Fix 1 — delete orphaned saved Reasoning Notes / rules

A Reasoning Note promoted into the Personal Rule Library is stored as an independent rule record. Deleting the source form therefore does not implicitly destroy the saved rule.

Changes:
- Added **Delete permanently** to every saved rule card, including touch/phone layout.
- Added `DELETE /api/rules/:id` to the browser API.
- Permanent rule deletion creates a rule tombstone and marks cloud state dirty immediately, so the deletion propagates through Google Drive and cannot be resurrected by another device.
- Archive remains available as a non-destructive alternative.
- Orphaned saved rules now show `Source form deleted` instead of offering a dead source-entry button.

## Fix 2 — desktop cloud sync recovery

### Status-state correction
The top bar previously treated any dirty local state as `Syncing cloud`, even if the actual cloud state was `error` or `offline`. This could display `Syncing cloud` indefinitely after a failed request.

New status priority:
1. actual active connection/sync
2. cloud error/offline/unconfigured
3. local pending changes
4. synced/local

`Syncing cloud` now means an actual sync is running. Dirty-but-idle state is shown as `Cloud sync pending`. Failed cloud requests show `Cloud sync error`. The same precedence is enforced in both the cloud-status renderer and the local sync-status adapter so one cannot overwrite the other with a false pending/syncing state.

### Network watchdog
- Worker token request timeout: 15 seconds.
- Google Drive request timeout: 20 seconds per request.
- A stalled request now exits the sync promise and returns the UI to an actionable error state instead of leaving an immortal in-flight sync promise.

### Faster safe first sync
After browser/site data is cleared, the remote Drive index is also cleared. The previous implementation then downloaded every form/rule file serially.

v18.2 reads changed Drive form/rule files with bounded concurrency of 4. This accelerates first-device reconstruction without using aggressive parallelism.

### Non-destructive cloud merge
Normal Google Drive sync no longer calls the full-database `replacePackage()` path.

Previously a sync merge could:
1. snapshot local data,
2. wait,
3. clear the forms/rules stores,
4. rewrite the older snapshot.

A local form or note created during that window could be overwritten.

v18.2 applies remote forms, rules, entry tombstones, form tombstones, rule tombstones and settings incrementally. Form/rule application uses short atomic IndexedDB read-write transactions, so local writes are serialized against the exact record being merged. Unrelated local records are never cleared during normal cloud synchronization.

Full local backup restore remains intentionally destructive because restore semantics explicitly replace the database.

## Cache revision
PWA shell/cache revision bumped from v20 to v21.
