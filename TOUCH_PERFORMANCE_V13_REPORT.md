# ThunderShadow v13 Touch Performance / UX Update

This release changes only touch/mobile UI behavior and performance-related presentation/event handling. IndexedDB, Cloudflare Worker authentication, Google Drive sync, and cloud configuration remain unchanged from v12.

## Performance changes

- Animated rain and lightning are disabled in Touch UI.
- The cloud/storm layer is static in Touch UI and no longer uses blur/filter work.
- Touch dialog/toast backdrop blur is disabled.
- Expensive shadows/transitions are removed from frequently-scrolled touch cards and controls.
- The `visualViewport.scroll` listener was removed; it previously caused viewport/layout work during scrolling.
- Viewport/orientation resize processing is debounced.
- Touch views are hard-contained horizontally and optimized for vertical panning.

## Persistent phone logger sections

Settings now has independent Expanded/Collapsed controls for Reasoning Pattern, Reasoning Note, and Speed Flags. State is stored locally under `thundershadow:touch-section-defaults`; direct logger toggles update the same persistent preference.

## Accordion layout

On portrait phones, expanded optional sections remain in normal document flow and push later controls downward rather than covering them. The compact phone-landscape logger remains separately optimized.

## Analysis phone layout

- Analysis containers are capped to viewport width.
- Phone Analysis uses a one-column grid.
- Filters and selects are width-contained.
- Tables become stacked labeled data cards on phones.
- Long values wrap safely.
- Horizontal panning cannot widen the root app into a grey off-canvas area.

## Verification

- All project JavaScript and service-worker JavaScript pass `node --check`.
- No duplicate HTML IDs.
- Six section-preference controls are present and bound.
- `visualViewport.scroll` is absent.
- Analysis table cells include `data-label` metadata used by the phone card layout.
- Service-worker asset paths resolve.
- CSS brace sanity check passes.
- SHA-256 comparison confirms `js/browser-api.js`, `js/sync.js`, `js/cloud-sync.js`, and `js/config.js` are unchanged from v12.

A local Chromium executable was detected, but the sandbox did not allow a reliable automated browser session, so final physical Safari rendering should still be checked after deployment.
