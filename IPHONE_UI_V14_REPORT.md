# ThunderShadow v14 iPhone UI Fixes

This release preserves the local-first IndexedDB and Google Drive sync architecture and changes only presentation/layout behavior.

## Fixed

- Rain remains enabled in Touch UI; light mode uses darker, higher-contrast rain streaks.
- The phone Reasoning Pattern expansion is forced into normal document flow with explicit auto-sized rows so it cannot float over or render beneath Reasoning Note / Speed Flags.
- Logger navigation/settings chrome is suppressed while a phone form is open; persistent Expanded/Collapsed preferences remain in the main Settings screen.
- The iPhone logger now uses the complete usable viewport with no outer bottom gutter or app footer leakage.
- The Analysis screen now uses compact phone-native filters, 2x2 statistics, single-column analysis panels, tighter cards, and stacked labeled table rows.

## Verification

- All JavaScript and service-worker files pass node --check.
- No storage, sync, OAuth, Drive, IndexedDB schema, or analytics calculations were modified.
- Service-worker shell/cache asset version was bumped to v15 to avoid stale mobile UI assets after deployment.
