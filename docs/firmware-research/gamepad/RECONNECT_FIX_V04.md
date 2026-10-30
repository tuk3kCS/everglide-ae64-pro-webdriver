# v0.4: saved mappings and reconnect input

October 29, 2026. Image: `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.4.bin`, **137,768 bytes**, SHA-256 `ac7b7b460aeb878969ec1a4b5c286b57c8e562da077f48bfa5db68e2f1e585fe`.

## Confirmed cause

Read-only queries to the user's running v0.3 found:

- Windows reports the AE64's Xbox 360 interface as present and healthy; a native XInput slot is connected.
- AGP1 reports its startup revision and the six-key compiled example, including Q/E trigger endpoints of **3500 micrometers** and WASD stick directions with the same endpoint.
- Performance reads for all six keys report **3310 micrometers** maximum and calibrated status 1.

The v0.3 startup validates its example against a temporary 10000-micrometer ceiling, then scanning replaces that ceiling with the actual switch limits. The physical mapper rejects any bound analog endpoint beyond its switch's maximum. Because the example asks for 3500 while the keys allow 3310, the entire report stays neutral. This explains how a controller can enumerate in Steam/Windows while producing no changed input for a browser tester. No settings, USB mode, firmware or calibration were changed during these diagnostic reads.

Power loss also loses v0.3 mappings because they are RAM-only. The previous browser auto-read adopted that rebooted example and persisted it over the local draft. These were two separate reset mechanisms, now addressed together.

## Changes

**Safe startup.** The compiled boot configuration has no physical assignments. An absent, corrupt or unsupported saved record also becomes empty. The six-key example remains an explicit browser action and a test fixture; it is not a boot fallback. No explicit user travel window is silently shortened by the firmware.

**Persistent mappings.** A verified Apply saves all 208 configuration bytes in the active onboard profile: assignments, output mode, analog windows, curves and stick settings. Native keymap and Fn saves preserve that record. Native profile loads restore that profile's mapping and reset/rearm controller input. The browser's confirmed Overview cache is scoped to the onboard profile so it cannot label another profile's assignments as active.

**Preserved drafts.** Automatic connection reads remember the actual hardware state and update capabilities, while retaining a valid saved draft or edits made during discovery. If the two differ, the driver says so and offers Apply or explicit Read. It never automatically uploads an unapplied draft. An explicit Read replaces the draft at the user's request; a verified Apply updates the confirmed hardware snapshot.

**USB configuration replay.** A repeated SET_CONFIGURATION notification no longer clears an IN buffer still owned by USB or arms the OUT buffer twice. Reset/disconnect completion remains the ownership-release boundary. This is a separate source-proven guard; it is not claimed as the observed cause of the cold-start neutral reports.

**Fresh Fn cache.** USB initialization explicitly reloads the active Fn-color record rather than relying on an already-loaded cache during initialization. Existing Fn storage and RGB rendering are preserved.

The Xbox USB visibility switch remains session-only and boots enabled, as in v0.3. Mapping persistence does not change that separate preference.

## Storage and failure behavior

Each native onboard-profile keymap allocation is 8KB. Its verified native prefix ends at offset `0x16AB`; FNR1 occupies `0x1700..0x1B7F`. GPR1 occupies **`0x1C00..0x1CEF`**, leaving both earlier regions and intervening bytes intact. The existing profile address stride is preserved.

GPR1 has a 32-byte versioned header and 208-byte configuration, with profile identity, strict reserved fields, length and CRC validation. The codec validates the configuration shape against the protocol ceiling; runtime scanning still enforces actual calibration and travel. The current record uses default-enabled USB metadata; live visibility remains independent and is not restored from this record.

Apply uses the native active-profile keymap save, appends the cached Fn record, then writes the gamepad payload before its validating header. Mapped flash readback is required before installing or acknowledging the new controller mapping. Failure is reported as storage failure rather than a successful save. The active RAM mapping is retained on failed Apply.

This inherits the native erase/rewrite power-loss boundary. It is not a two-bank transaction: an interrupted or failed flash operation may leave no valid saved trailer. On a later boot that becomes an empty mapping, never the six-key example. Export a backup before firmware changes or factory reset. Returning to stock/older firmware can erase custom trailers on a subsequent native keymap save.

## Validation

The new image was compiled for RV32IMAC, linked within the existing flash/RAM bounds, and checked for container CRC/SHA, original-byte preservation, all integration calls/trampolines/descriptor pointers and unchanged native RGB ranges. BSS remains **3792 bytes** in the existing 4096-byte reservation.

Portable C tests run under Node WASI passed:

- **1,332,393** storage checks covering every trailer bit, all four profiles, malformed valid-CRC records, partial/failed programming, alignment and neighboring/native/Fn preservation.
- **7,895** board checks covering real protocol commit/readback, cold reboot, a saved 3.00mm endpoint on 3.31mm switches producing full output, repeated configuration with in-flight ownership, native/Fn saves, profile isolation and corrupt/failed records.
- Existing board, 3.31mm regression, Fn protocol/storage/board and USB visibility suites; 390 browser-client/compiled-C Fn protocol packets.

Driver regression tests cover volatile and persistent firmware, preserved custom ranges/bindings/modes/names, read races, explicit Read, verified Apply and zero automatic uploads. All existing JavaScript test entry points and image packaging checks also passed.

Build manifest, ELF, verification record and source hashes are in `firmware/custom/ae64-xinput/v0.4/`. The v0.2/v0.3 images remain unchanged; v0.3 source is archived in `history/v0.3-source.zip`.

**This new image has not been flashed or physically validated during this work.** The old neutral-startup cause was confirmed with read-only hardware data; the fix's reboot/output behavior was tested in simulation. Native USB error handling can still omit an IN completion callback; this revision does not blindly clear DMA ownership on a timeout. If input still stalls with a valid saved mapping, further transfer diagnostics are needed rather than assuming controller enumeration proves input delivery.

## Use after upgrading

1. Install v0.4 using the updated local driver's Firmware tab.
2. In Gamepad mode, keep/import your desired draft, review the actual switch ranges and click **Apply to keyboard** once. The driver should report that the profile was saved to the keyboard.
3. Release all mapped keys, unplug/reconnect, then test the same onboard profile. The physical mapper deliberately requires release before rearming after startup/reset.
4. Focus the tester page and press a mapped key. Browsers expose gamepad connection/input to a focused page after interaction; see [Gamepad API behavior](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API).

Mappings already lost from v0.3 RAM or overwritten browser storage cannot be reconstructed from the keyboard. Re-import an exported profile or configure them once. Installing v0.4 alone does not invent the user's earlier assignments.
