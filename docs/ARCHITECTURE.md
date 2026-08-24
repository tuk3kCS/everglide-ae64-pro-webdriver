# AE64 Pro Control architecture

AE64 Pro Control is a dependency-free static WebHID application. It uses ordered classic scripts instead of a bundler, so it can run from any HTTPS static host and remain easy to audit against captured keyboard traffic.

The EPOMAKER HE30 driver was used as the structural reference: keep a small bootstrap, divide UI and device concerns into focused files, and preserve one explicit script order. The AE64 protocol and state model remain independent because the two keyboards use different HID commands and data layouts.

## Runtime order

`index.html` loads these files in order:

1. `protocol.js` — HID transport, packet codecs, constants, and commands.
2. `js/app/foundation.js` — layout/catalog data, translations, application state, and shared helpers.
3. `js/app/theme.js` — Mint/Dark/Light appearance tokens and local persistence.
4. `js/app/pages.js` — page markup and keyboard/status renderers.
5. `js/app/interactions.js` — staged edits, page controls, and RGB selection gestures.
6. `js/app/device.js` — connection, workspace reads, key reads, and write verification helpers.
7. `js/app/live.js` — live RGB matrices, Fn status, calibration, travel tests, and polling.
8. `js/app/profiles.js` — change review, apply/revert, onboard profiles, import, and export.
9. `app.js` — permanent shell bindings and startup only.

These are classic scripts that intentionally share top-level declarations. Do not add `async`, `defer`, or `type="module"` to individual script tags without converting the whole dependency model.

## Data and write flow

Page controls update the staged `state.profile` and mark the relevant dirty group. Confirming the Apply dialog calls the writer for each dirty group. Experimental auto apply calls the same verified writer after a short debounce; it does not use a separate protocol path. Writers read firmware-owned fields where needed, write the staged values, read them back, and commit only the matching flash group. Live readers and polling never commit data.

`protocol.js` is the only layer that should construct raw 64-byte HID reports. Application modules call its named transport methods and work with decoded objects.

## Extending the driver

- Put reusable layout data, labels, or state defaults in `foundation.js`.
- Put page HTML generation in `pages.js` and its temporary listeners in `interactions.js`.
- Put browser-local appearance behavior in `theme.js`; themes must never change device data.
- Put reads/writes and connection lifecycle in `device.js`; keep live or continuously sampled features in `live.js`.
- Put staged-change review and profile persistence in `profiles.js`.
- Keep `app.js` limited to permanent document listeners and startup.
- Keep each application file below 1,000 lines; split by feature when it approaches that limit.
- Add every runtime file to `index.html`, the Pages packaging step, and `smoke-test.cjs` in the same change.

## Verification

Run `node smoke-test.cjs`. It checks packet mappings, browser bootstrap, module order and size, published-file isolation, language XML, lighting geometry, hidden-feature visibility, and the absence of firmware-update commands.
