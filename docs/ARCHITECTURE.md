# AE64 Pro Control architecture

AE64 Pro Control is a dependency-free static WebHID application. It uses ordered classic scripts instead of a bundler, so it can run from any HTTPS static host and remain easy to audit against captured keyboard traffic.

The EPOMAKER HE30 driver was used as the structural reference: keep a small bootstrap, divide UI and device concerns into focused files, and preserve one explicit script order. The AE64 protocol and state model remain independent because the two keyboards use different HID commands and data layouts.

## Runtime order

[index.html](../index.html) defines the load order. The driver starts with `protocol.js` and the gamepad, flasher and Fn RGB protocol modules. The application scripts then load shared state, translations and theme, feature editors, integration modules, page rendering and listeners, device and profile operations, and finally the permanent shell bindings in `app.js`.

The scripts share top-level declarations. Keep dependency order when adding or moving a script.

## Data and write flow

Page controls update the staged `state.profile` and mark the relevant dirty group. Confirming the Apply dialog calls the writer for each dirty group. Experimental auto apply calls the same verified writer after a short debounce; it does not use a separate protocol path. Writers read firmware-owned fields where needed, write the staged values, read them back, and commit only the matching flash group. Live readers and polling never commit data.

`protocol.js` constructs native configuration reports and serializes access to the device. The firmware updater, AGP1 client and FNR1 client encode their own packets and use the same transport. Application modules call those clients and work with decoded values.

## Extending the driver

- Put reusable layout data, labels, or state defaults in `foundation.js`.
- Put page HTML generation in `pages.js` and its temporary listeners in `interactions.js`.
- Put browser-local appearance behavior in `theme.js`; themes must never change device data.
- Put self-contained advanced-feature editors and tutorials in their own modules, as with `rappy.js` and `mpt.js`.
- Put reads/writes and connection lifecycle in `device.js`; keep live or continuously sampled features in `live.js`.
- Put staged-change review and profile persistence in `profiles.js`.
- Keep `app.js` limited to permanent document listeners and startup.
- Keep each application file below 1,000 lines; split by feature when it approaches that limit.
- Add every runtime file to `index.html`, the Pages packaging step, and `smoke-test.cjs` in the same change.

## Verification

Run `node smoke-test.cjs`. It checks packet mappings, browser bootstrap, module order and size, published-file isolation, language XML, lighting geometry, hidden-feature visibility, and the absence of firmware-update commands.
