# Project analysis and UI update

Reviewed on October 29, 2026. Scope: application structure, state and persistence, device communication, page rendering and interaction bindings, gamepad and lighting integration, firmware workflows, tests, deployment configuration, and the five requested UI changes.

## Architecture

This is a buildless browser application for the Everglide AE64 Pro. HTML, CSS, and ordered classic JavaScript files run directly in Chrome or Edge. Configuration uses WebHID over a local USB connection. A static HTTP server is sufficient for development; there is no application backend, package installation, or frontend compilation requirement.

| Layer | Main sources | Responsibility |
| --- | --- | --- |
| Shell and bootstrap | `index.html`, `app.js` | Navigation, shared dialogs, connection controls, language/theme selectors, startup and hash routes. |
| Shared model | `js/app/foundation.js` | Physical layout, default profiles, shared state, catalogs/constants, hardware-address helpers, local workspace loading. |
| Rendering | `js/app/pages.js` | Page markup, keyboard previews, selection summaries, toolbars and status. |
| Interaction binding | `js/app/interactions.js` | Page-specific event handlers, selection gestures, performance and lighting edits. |
| Device lifecycle | `js/app/device.js`, `js/app/live.js` | Device discovery, reads, polling, live distance/RGB, profile synchronization and calibration. |
| Writes and backups | `js/app/profiles.js` | Staging, apply review, verified writes, auto apply, revert, profile changes and JSON import/export. |
| Key behavior editors | `js/app/mapping.js`, `key-picker.js`, `dks.js`, `mpt.js`, `rappy.js`, `mt-end-toggle.js`, `macro.js` | Mapping catalogs, modifier combinations, advanced behaviors and macros. |
| Gamepad | `js/gamepad/*`, `js/app/gamepad-page.js`, `gamepad-overview.js` | Separate configuration model, assignment editor/simulator, custom protocol and integration with the shared connection. |
| Lighting | `js/app/lighting-color.js`, `fn-lighting.js`, `js/lighting/fn-rgb.js` | Main/strip colors and selections, custom Fn-layer capability detection, drafts and saves. |
| Firmware | `js/firmware/flasher.js`, `reconnect.js`, `js/app/firmware-page.js` | Image inspection, transfer, identity-aware reconnection, recovery and updater UI. |
| Appearance and language | `styles.css`, feature CSS, `js/app/theme.js`, `i18n.js`, `languages.xml` | Shared theme tokens, responsive layouts and English/Vietnamese translations. |

The script order in `index.html` is part of the application contract. The application modules share top-level declarations rather than importing explicit dependencies. For example, rendering calls feature helpers, interaction handlers call renderers, and device code updates the shared state. This makes small changes straightforward but requires care when renaming helpers or moving scripts.

## State, rendering and persistence

The shared state separates the editable `profile`, records read from `hardware`, dirty flags/sets, selection state, and polling timers. The physical keyboard has 64 keys; its configuration matrix uses separate firmware coordinates. Four onboard profiles and four mapping layers must not be confused with the independent Fn lighting drafts.

`render()` disposes the mounted gamepad editor, stops page polling, replaces the page content, translates it, then attaches handlers again. This explains why relocated controls should retain their IDs and be generated once: missing or duplicate IDs can disconnect the visible control from its existing event binding. Polling and editor cleanup are also correctness concerns when changing pages.

Ordinary edits update the working copy and dirty sets. Apply reads existing device records where needed, preserves firmware-owned fields, writes changes, commits them, and verifies responses. Auto apply uses the same write path after completed edits. Successful ordinary applies save the workspace to browser storage. An unsaved ordinary edit should therefore not be assumed to survive a reload simply because a profile can be loaded from local storage.

Gamepad drafts have a separate browser-storage key and JSON format. The gamepad editor persists its own drafts and has its own Apply action. Custom Fn colors also use a separate per-profile/per-layer editing and save workflow. Workspace, gamepad and Fn backups are not interchangeable.

The bootstrap suppresses physical keyboard events at the document capture phase, with explicit exceptions for permitted input fields. New editable fields need the existing input-allow convention; otherwise the device under test can interfere with ordinary page controls, or a field can become impossible to type into.

## Device communication and feature boundaries

`protocol.js` implements 64-byte vendor-HID reports and serializes transactions through a promise queue. It validates packet values, matches responses, handles timeouts and provides an exclusive lease for firmware operations. Device identity checks distinguish the supported board from other keyboards.

The normal protocol covers identity, profiles, mappings, Hall performance, RGB, advanced behaviors and macros. Gamepad and custom Fn RGB add separate capability-gated extensions. Their existence in the UI does not establish that stock firmware supports them.

Gamepad rendering and simulation are independent of the keyboard driver, while the integration layer supplies the active transport and each physical key's switch travel. The model validates all 24 controller slots, unique physical assignments, analog ranges, curves and both stick settings. Analog controls derive output from travel; digital controller buttons use the keyboard's pressed state. Capability detection can automatically read a compatible keyboard profile; that read must continue to take precedence over a fresh empty preview.

The Lighting page combines a shared keyboard/perimeter preview with separate editors. Keyboard LEDs and the 38 perimeter LEDs have distinct base settings, palettes and dirty flags. The north/south switches manipulate bits of the main keyboard's open mode. Strip power uses the strip's own base record. Moving the keyboard switches must preserve this distinction.

Firmware inspection checks the container header, board identity, lengths, CRC and optional catalog hash/size. The updater transfers the image under an exclusive connection lease and requires validation before restart. Reconnection uses existing permissions and device identity across application/bootloader transitions. These mechanisms have simulated regression coverage; this review did not flash or write a physical keyboard.

## Requested changes and their causes

### Gamepad preview

The editor previously initialized from `AE64GamepadModel.defaults()`, which represents the six-key example: Q/E for triggers and WASD for the left stick. That example was being used as a new user's draft.

Added `emptyProfile()` and changed only fresh editor initialization to use it. All 24 bindings now start unassigned. Existing saved drafts, imported profiles and profiles read from the keyboard continue through their existing paths. The explicit Restore example profile action still loads the six-key example. The template's initial assignment count now also says zero.

### Overview

Added the existing `hidden` utility class to the controller-keymaps panel. The panel and its supporting behavior remain available for later restoration. Controller badges on the main Overview keyboard are unaffected.

### Advanced

The nine feature cards used 14px titles, 10px descriptions and 7–8px metadata/actions. Increased titles to 18px, descriptions to 14px, symbols to 13px, status/index text to 10px and footer text to 11px. Explicit line heights and spacing accommodate wrapping within the existing responsive three/two/one-column layout.

### Lighting

Extracted the existing switch markup into `lightingPowerControls()`. In the Keyboard lighting section, the command panel now contains Live hardware RGB followed by Lighting power, North-facing LEDs and South-facing LEDs. Removed the former keyboard power panel from the lower editor so there is no empty panel or duplicated switch ID.

The four controls share one desktop row, wrap to two columns at the existing intermediate breakpoint, and stack on small screens. Strip power retains its separate panel and target. Existing event bindings and dirty-state behavior are reused.

### Performance

The screenshot's joined text was caused by adjacent inline `<b>` and `<small>` elements inside the toggle label. The row itself was flex-based, but the title/description wrapper had no stacked layout. Added a grid wrapper, a defined gap, explicit font sizes/line heights and wrapping, scoped to Performance tuning.

The generic `.switch-row` rule also overrode the earlier padding/borders of the live-distance and experimental-release cards. More specific Performance selectors now preserve their inset spacing and borders. Normal actuation, experimental release and Rapid Trigger states were checked.

## Validation

All 14 existing offline entry points passed: the main smoke test, six gamepad suites, three Fn lighting suites and four firmware suites. The firmware tests also verified the six catalog images. Relevant existing tests now cover empty initial drafts, manual assignment, preserved saved mappings, explicit example restore, the hidden Overview panel and the new Lighting switch location/order.

Headless Edge checks used an isolated browser profile and a stubbed HID device inventory. They verified:

- Empty gamepad startup, assigning a control, retaining it after reload and restoring the example.
- The four Lighting controls' order and desktop alignment, main power/bank behavior and independence from strip power.
- Nine Advanced cards and their updated computed font sizes.
- Hidden Overview controller panel.
- 60 rendered layouts across English/Vietnamese, widths of 390, 640, 820, 1024, 1366 and 1920px, and normal/experimental-release/Rapid Trigger variants.
- No horizontal overflow inside the changed controls/cards, no overlapping Performance toggle titles/descriptions, and no browser script errors during that matrix.
- 27 additional horizontal/vertical fit checks for the changed components across Mint, Dark and Light themes at desktop and narrow widths.

Browser checks and offline protocol simulations do not validate physical LED output, actuation behavior or firmware flashing. No physical-device writes were performed.

## Existing findings and follow-up opportunities

1. **Narrow-screen page overflow remains outside the changed controls.** At 640px the Lighting page reaches 741px because of its keyboard/perimeter preview; at 390px the English Performance page reaches 408px. Repeating those cases with the original stylesheet produces the same widths. The changed toggle/card components fit their containers. A separate responsive-layout pass should address the page/preview sizing rules.
2. **The protocol reference is behind the implementation.** The command-family table in `docs/AE64_PROTOCOL.md` still describes some advanced/macro writers as deferred and firmware upgrading as excluded. The current code and dedicated tests implement those paths. Treat the current implementation and focused firmware/gamepad/Fn guides as necessary companions until the table is updated.
3. **Shared globals increase coupling.** The ordered classic-script design has no explicit dependency graph. Gradual extraction of pure models/helpers and explicit interfaces would make future changes easier to reason about; a bundler migration is not required for the current task.
4. **The main renderer and binding file are central maintenance points.** `pages.js` and `interactions.js` must agree on element IDs, page-specific state and lifecycle cleanup. New controls should reuse feature helpers rather than duplicating markup and bindings across pages.
5. **Offline coverage is strong on behavior, limited on presentation.** The existing VM/fixture tests successfully check protocols, lifecycle and markup, but cannot detect CSS text collisions such as the supplied screenshot. A small browser smoke suite for representative layouts would cover that gap.
6. **Hardware validation remains a separate milestone.** Current gamepad assignments are session-only in the custom firmware; exported backups remain relevant. The custom firmware/Fn persistence and analog behavior still need physical-device verification as described in the project README.

GitHub Pages CI runs offline checks, assembles the static site, includes feature CSS/JS and local assets, and packages firmware. These changes need no new runtime dependency or build step. The existing local navigation-order edit in `index.html` was preserved. No hosting configuration or deployment was changed.
