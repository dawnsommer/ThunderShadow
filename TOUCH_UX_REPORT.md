# ThunderShadow Touch UX v12

This release keeps ThunderShadow's IndexedDB and Cloudflare Worker / Google Drive sync architecture unchanged and redesigns only the touch/mobile presentation and touch interaction layer.

## Primary logger changes

- Separate responsive touch layouts for phone, iPad portrait, and iPad landscape.
- iPhone landscape is treated as a phone workflow instead of falling into the tablet layout.
- Touch logger hides the persistent area navigation while a form is open so the logger receives the viewport.
- Touch top bar is reduced to essential navigation/status controls.
- Desktop-only theme, UI-mode, backup, restore, and zoom controls no longer consume touch-header space; display mode and theme are available in Settings.
- Top Previous/Next controls are removed from the touch logger; the sticky bottom Previous / Save & Next bar is the single navigation/action surface.
- Entry navigator is collapsed to a compact 52 px row by default and expands as an overlay only when needed.
- New Entry and Entry Actions are available directly from the compact entry row.
- Delete/restore, permanent delete, form export, and finish/reopen actions move to a touch action dialog instead of occupying the logger header.
- iPhone Error Code choices use a large two-column grid; Error Code 7 spans the final row.
- Error Code receives the flexible/remaining logger height on iPhone.
- Reasoning Pattern, Reasoning Note, and Speed Flags use progressive disclosure on iPhone.
- Pattern/Note/Speed summaries show the current selection state while collapsed.
- Reasoning Pattern and Error Code explanations/desktop shortcut badges are removed from the permanent phone surface.
- Pattern Guide remains reachable with a 44 px info target.
- Speed flags use a compact two-column touch grid.
- Reasoning Note no longer reserves 150–170 px while unused; it expands only when opened.
- iPad portrait uses two primary columns with Note/Speed below.
- iPad landscape uses the full three-column logger.
- iPhone landscape uses a compact two-column composition with the Error Code grid kept visible.

## Touch sizing and spacing

- Standard touch targets normalized to a 44 px minimum for buttons, icon buttons, tabs, form-card actions, segmented controls, and small utility controls.
- Primary Save & Next action is larger and receives roughly two thirds of the bottom action bar.
- Touch typography increases desktop microtext that was previously 8–11 px.
- iPhone text inputs/selects/textareas use 16 px text to prevent Safari focus zoom.
- Form quick-fill length buttons are now 44 px touch targets.
- Consistent compact spacing is used within the logger instead of the previous oversized phone stack.

## Viewport / iOS behavior

- Touch shell uses dynamic viewport height and `visualViewport` updates for browser chrome and keyboard changes.
- Safe-area insets are respected in the top bar, workspace, entry overlay, and bottom action bar.
- Touch UI ignores desktop interface zoom and uses fixed device-optimized sizing; the stored desktop scale is preserved.
- Orientation changes recalculate touch layout and viewport height.

## Library, dialogs, Analysis, Rules, Settings

- On touch, tapping a form card opens it; the redundant Open button is hidden.
- Form-card secondary actions use 44 px targets.
- Phone search uses available width and New Form remains directly accessible.
- Phone Create/Edit Form dialogs use a single-column field layout.
- Dialog actions receive larger targets and fit the dynamic viewport.
- Rule/analysis/settings microtext and controls are enlarged for touch.
- Rule controls stack on phones instead of compressing horizontally.
- Review-response buttons use a two-column phone grid.
- Theme controls are now available in Settings so hiding the top-bar theme selector in Touch UI does not remove the function.

## Data / sync invariants

No IndexedDB, Cloudflare Worker, Google Drive adapter, OAuth, dirty-state, conflict-resolution, tombstone, or cloud schema code was intentionally changed in this UX release.

## Static verification performed

- All JavaScript files and the service worker pass `node --check`.
- HTML parses successfully with no duplicate IDs.
- Every static `$("id")` reference in `js/app.js` resolves to an element in `index.html`.
- All new touch control IDs are present exactly once.
- The CSS stylesheet parses without syntax/declaration errors using `tinycss2`.
- Phone, phone-landscape, iPad portrait, and iPad landscape breakpoint rules are present.
- Cloud/sync source files are byte-compared against the v11 Cloudflare/Drive base during release packaging.

A live Chromium rendering attempt was blocked by the execution environment's administrator policy for local/file URLs, so visual validation on physical Safari remains the final recommended deployment check.
