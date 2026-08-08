# ThunderShadow v18.4 — IndexedDB self-healing

## Root cause addressed
Normal app operations and the Verified browser snapshots panel share the same IndexedDB storage layer. A browser-profile-specific IndexedDB open or transaction can remain pending indefinitely, which freezes form creation, exports, settings, and backup listing even when Google Drive is disconnected.

## Changes
- IndexedDB open now has a 3.5-second hard timeout and handles `onblocked` explicitly.
- Store transactions now have a 6.5-second hard timeout.
- Atomic merge/tombstone transactions have the same bounded behavior.
- Database connections are reused rather than repeatedly opening/closing the same database for every operation.
- If the primary IndexedDB database is blocked/unresponsive, ThunderShadow automatically switches that browser profile to a new recovery IndexedDB database.
- The original database is NOT deleted.
- When recovery activates, stale cloud dirty-state and cached Drive index metadata are cleared so an empty recovery DB cannot be pushed as authoritative deletions.
- Reconnecting Google Drive can repopulate the recovery database from the user's existing Drive data.
- A visible toast reports when storage recovery was activated.
- `/api/settings` exposes the active database/recovery state for diagnostics.
- Service worker/cache generation bumped to v23.
