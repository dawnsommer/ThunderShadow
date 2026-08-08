# ThunderShadow v18.5 — IndexedDB Emergency Fallback

When both the primary and recovery IndexedDB databases fail to open, ThunderShadow now switches to a localStorage-backed emergency store for forms, rules, settings, and tombstone metadata. Verified browser snapshots are disabled in this mode to avoid localStorage quota exhaustion. Cloud sync and JSON/TSV exports remain available. The existing IndexedDB databases are not deleted.
