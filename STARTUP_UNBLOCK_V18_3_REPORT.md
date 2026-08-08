# ThunderShadow v18.3 — Startup Unblock / Backup Isolation

- Scheduled browser snapshots no longer block foreground API requests.
- Form loading, form creation, saves, exports, and Settings do not await backup maintenance.
- Scheduled backup work is queued during idle time / after foreground startup.
- Backup listing uses IndexedDB keys + lightweight metadata instead of cloning every full snapshot payload.
- New snapshot metadata is cached separately for fast listing; legacy snapshots remain downloadable/previewable and are lazily verified when opened.
- Backup retention cleanup no longer clones all retained backup payloads.
- PWA cache revision bumped to v22.
