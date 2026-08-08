# ThunderShadow v18 — Device-local Rain Control

## Change
- Added Settings → Rain effect → On / Off.
- Default remains On.
- Preference is stored in localStorage on the current browser/device only.
- Off removes the rain layers from rendering and stops their CSS animations.
- The preference is applied in `theme-init.js` before normal app initialization to avoid starting rain briefly on launch when the device preference is Off.
- No IndexedDB schema, Google Drive sync payload, OAuth, backup/restore, logger, analysis, or rule-review data logic was changed.

## Cache
- GitHub/PWA shell cache bumped to v19 so the new Settings control and behavior are fetched.
