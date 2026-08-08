# ThunderShadow v16 — iPhone viewport + view isolation fixes

## Scope
This release fixes the remaining touch-mode issues reported after v15 without changing IndexedDB, Google Drive sync, OAuth, logging data, or analytics calculations.

## Fixes
1. **Logger selection screen no longer exposes the previous tab underneath**
   - Added one authoritative primary-view manager shared by `app.js` and `v3.js`.
   - Exactly one workspace view receives `is-active-view`; all sibling views are hidden and non-renderable in touch mode.
   - The same lifecycle now governs Logger with no selected form, an opened logger form, Analysis, Active Rules, Rule Library, and Settings.

2. **Touch app fits the active visual viewport**
   - `visualViewport` now supplies width, height, top, and left geometry.
   - Phone CSS no longer mixes measured viewport height with a competing `100dvh` height in the final override.
   - The app shell and storm background use the same measured rectangle.
   - `visualViewport` resize and scroll changes are tracked.
   - Active views are clamped to the workspace; scrolling occurs inside the active content surface rather than on the document.

3. **Bottom dark/black strip mitigation**
   - Light/dark `theme-color` now follows the resolved app theme at initial paint and during theme changes.
   - Body, storm, and app shell use matching touch viewport geometry/backgrounds through the safe area.
   - The app document footer remains disabled in touch mode.

4. **Light-mode rain visibility**
   - Rain remains enabled in touch mode.
   - Light-mode rain uses darker, wider high-density streaks, higher opacity, multiply blending, and increased contrast.
   - Lightning remains disabled on touch to avoid unnecessary full-screen repainting.

5. **Cache refresh**
   - Service-worker shell cache bumped to `thundershadow-github-shell-v17`.
   - Runtime asset query revision bumped to `v=17`.

## Regression boundaries
No changes were made to browser-storage schema, entry save semantics, Drive OAuth/sync logic, backup/restore data format, reasoning code definitions, or analytics calculation logic.
