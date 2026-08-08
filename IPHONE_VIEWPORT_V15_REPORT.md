# ThunderShadow v15 — iPhone viewport boundary fix

## Fixed

- Core logger/library now explicitly hide Analysis, Active Rules, Settings, and V3 Library views before becoming visible. This removes the stale sibling-view leak that could appear underneath the logger after switching tabs.
- On phone touch layouts, every primary view is absolutely bounded to the workspace so no sibling view can extend the document below the logger.
- The touch app shell now uses a fixed full-viewport grid. Logger mode removes the area-nav row and receives the entire remaining viewport.
- The mobile document footer is removed from the touch app shell; Privacy Policy remains available in Settings.
- The logger content remains the only vertical scroll surface inside the logger.
- iPhone/PWA safe-area painting now extends through the bottom edge instead of exposing a separate document/background strip.
- Service-worker/static asset revision bumped to v16 to avoid an installed iPhone PWA retaining the previous layout CSS.

## Unchanged

IndexedDB storage, entry logging semantics, Google OAuth/Drive sync, analytics calculations, rain, theme behavior, and desktop layouts are otherwise unchanged.
