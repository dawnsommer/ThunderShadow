# ThunderShadow v18.6 — Final Desktop Optimization

Base: v18.5.0 IndexedDB Emergency Fallback

## Scope
- Preserve the working phone/touch behavior.
- Preserve v18.5 IndexedDB recovery/emergency fallback.
- Reduce desktop sync/UI jank.
- Improve desktop light-mode rain contrast.

## Changes

### 1. Clean cloud-sync fast path
When local data is clean and the cached Google Drive namespace index is unchanged, Sync Now now exits immediately after the lightweight Drive file-list check. It skips:
- full local library export,
- remote merge processing,
- tombstone traversal,
- unnecessary UI merge event.

### 2. No full UI reload after local-only uploads
`thundershadow-cloud-merged` now includes `remoteApplied`.
The app reloads/re-renders the complete forms library only when Drive actually supplied remote state. Uploading local edits by itself no longer causes a complete logger/library redraw.

### 3. GPU-composited desktop rain
Desktop rain now moves the repeating rain textures with `translate3d(...)` transforms instead of animating `background-position` across oversized layers. This reduces continuous raster repaint behind glass UI surfaces.

Touch/iPhone rain behavior remains unchanged.

### 4. Desktop light-mode rain contrast
Desktop light mode now uses darker, slightly wider multiply-blended rain streaks, based on the successful touch/iPhone treatment but tuned down for the larger display.

### 5. Cache/version
- App version: `18.6.0-final-desktop-optimized`
- Service-worker cache: `thundershadow-github-shell-v25`
- Static code asset query revision: `v25`

## Preserved
- IndexedDB remains the normal local source of truth.
- v18.5 recovery/emergency localStorage fallback remains intact.
- Google Drive appDataFolder architecture remains intact.
- Cloudflare Worker OAuth remains intact.
- Manual top-bar Sync Now remains intact.
- Touch/iPhone rain rules remain intact.
- Rain On/Off setting remains authoritative.
