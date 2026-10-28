# AE64 Pro: reconstructed changes across five firmware images

Target: AE64 Pro, USB `1CA6:300A`, board `0030000A`, product `C048P010`, catalog chip label `XS117`. Analysis date: October 28, 2026.

These are **binary-derived findings, not manufacturer patch notes**. Every supplied image was checked, extracted, scanned for strings and descriptors, and disassembled as RV32 with compressed instructions. Selected command handlers and report paths were traced and compared. The stripped applications have not been completely decompiled, and no firmware was executed during this investigation. The findings below are a supported subset of the changes, not an exhaustive behavioral changelog.

## Version summary

| Firmware / embedded build date | Container bytes | Payload bytes | Size change from prior supplied build | Confirmed or localized changes |
| --- | ---: | ---: | ---: | --- |
| v0.0.5.0 / March 5, 2026 | 116,464 | 112,368 | baseline | Already has Hall-performance settings, layout/global commands, WebHID and boot-entry handling. No earlier supplied image permits identifying what this release introduced. |
| v0.0.6.0 / May 19, 2026 | 116,608 | 112,512 | +144 | Adds a cause/EPC diagnostic to an exception stop path; adds profile-specific event flags when configuration changes; changes USB connection-state bookkeeping and report-state reset logic; changes RAM/stack layout. |
| v0.0.7.0 / June 25, 2026 | 116,992 | 112,896 | +384 | Clears the per-key `calibrate` status when the selected axis/switch ID changes; rewrites keyboard report construction, including an explicit ordinary-key bitmap bound and duplicate-bit checks. |
| v0.0.8.0 / September 1, 2026 | 118,232 | 114,136 | +1,240 | Rejects performance modes above 2; clears a per-key runtime bit when mode changes; mirrors shake optimization into configuration state and marks it dirty; adds lock-LED output fields to shared/NKRO Report ID 1; changes command reply handling. |
| v0.1.0.0 / September 30, 2026 | 118,776 | 114,680 | +544 | Changes shared/NKRO keyboard input to explicit key bits, padding and modifier bits; expands that input report from 16 to 17 bytes including ID; adds a 17-byte prior-report comparison/cache in the matching report-send path. |

Sizes alone do not quantify functionality or fixes. Many raw byte differences are relocated pointers, branch displacements and memory-layout changes.

## v0.0.5.0 baseline

All five containers share a 4,096-byte header with magic `0xBEAF5AA5`, board ID `0x0030000A`, declared payload length and CRC-32. All stored CRCs match. Reserved header bytes after the first 20 bytes are zero in these originals. There is no signature field evident in this observed header, but that does **not** establish that the absent bootloader accepts arbitrary new payloads.

Every image contains the diagnostic protocol string `V1.2.1.0`, RT-Thread assertion/function-name strings, USB diagnostics, and a RISC-V/newlib build path. The separate USB boot-keyboard descriptor, vendor HID descriptor and device descriptor are byte-identical across these five files. Application version numbers must be read through DeviceInfo or the embedded app constants; USB `bcdDevice` remains `0002`.

The native command table already includes global settings, key layout, per-key Hall-performance/calibration/status operations, and a transition into the updater. The five DeviceInfo handlers preserve the same response layout, with changing application version and build constants. See [native handlers](protocol/NATIVE_HANDLERS.md).

## v0.0.5.0 → v0.0.6.0

**Exception diagnostics.** The stop stub at payload `0xFE40` in v5 is an infinite loop. Its matching v6 path at `0xFE72` now formats `Exception occurred! cause: %ld, epc: %ld`, calls the formatting output routine, then loops. Later versions retain it. This adds diagnostic information; it does not prove that the underlying fault was fixed. Exact instructions and string references are in [focused native evidence](symbols/FOCUSED_NATIVE_FINDINGS.md) and `symbols/confirmed-deltas.json`.

**Profile-switch scheduling.** In request `02 03`, changing to an accepted profile adds writes to a second event/state word. Profile indices 0, 1, 2 and 3 select flags `0x08`, `0x10`, `0x20` and `0x40`, respectively. This is additional state notification. The downstream user-visible effect has not been established.

**USB bookkeeping.** The function anchored by `USB Connected`, `USB Disonnected`, `USB Mac Resume` and `USB Reset` gains a call on connection and changes one comparison threshold from 1,000 to 2,000. Its matching regions are v5 payload `0xB2EC` and v6 `0xB2C6`. The exact timing unit and the called routine's complete effects are not established; this is not presented as a measured disconnect delay or a console-compatibility fix.

**Report reset and memory layout.** A matching report-state clearing routine is rewritten from conditional byte-clearing loops to buffer clearing plus flag reconstruction. The initial stack pointer changes from `0x99400` to `0x98C00`, and the zeroed RAM region shrinks. UART instance wrappers move but are present in both versions; UART support was not newly added. See [startup maps](hardware/STARTUP_MEMORY_MAPS.md).

## v0.0.6.0 → v0.0.7.0

**Switch selection invalidates calibration status.** The driver calls request bytes 21–22 of `04 02` the `axisV2Id`. When this value changes, v7 adds a zero write to byte 8 of the corresponding per-key axis record. That byte is returned as response byte 20 and called `calibrate` by the driver. V6 stores the new axis ID without this zero write. This supports calibration-status invalidation when changing the selected switch/axis. It does not prove immediate complete sensor recalibration or a measured accuracy improvement.

**Report-building logic.** The matching report builder changes substantially. The v7 ordinary-key bitmap branch explicitly accepts `(usage - 4) & 0xFF <= 108`, tests a key bit before setting it, and separately handles boot-report slots. This identifies explicit bitmap-range and duplicate-bit handling. A complete input-path proof or latency comparison was not performed. See [HID/report-path findings](analysis/HID_REPORT_CHANGES.md).

The shared HID descriptor itself remains identical to v6; this change is in the code constructing its data.

## v0.0.7.0 → v0.0.8.0

**Performance-mode validation.** The write-performance handler now accepts only mode values 0, 1 and 2, which the driver names Normal, RT and IntervalRT. Values above 2 take an error path. On an accepted mode change it also clears bit `0x0004` in a per-key runtime halfword. The precise meaning of that unlabeled bit is unresolved.

**Shake optimization configuration handling.** Request `02 10` previously changed runtime flag bit 11. V8 additionally stores the resulting boolean in a configuration byte and sets a configuration dirty/event flag. This demonstrates new save/configuration handling. Persistence across power cycles remains untested and is not guaranteed by this observation.

**LED output on shared/NKRO interface.** Shared Report ID 1 gains LED usages 1–3 (Num Lock, Caps Lock and Scroll Lock), plus padding. Older releases already have an LED output in the separate boot-keyboard collection. The new behavior is support on this additional report/interface path, not first-ever lock-LED support.

**Other localized changes.** The central native command parser gains a flag that can suppress its normal reply after a handler call. One system-mode branch clears a parameter bit; factory reset gains a call. Their complete effects were not resolved and are not assigned invented feature names.

## v0.0.8.0 → v0.1.0.0

**Explicit modifier representation in NKRO input.** Shared Report ID 1 changes from 120 input data bits to a layout consisting of 109 ordinary-key bits (`0x04..0x70`), 11 constant padding bits, and eight modifier-key bits (`0xE0..0xE7`). This yields 16 data bytes, or 17 including report ID 1. The prior report was 15 data bytes, or 16 including ID. This is a concrete USB protocol change.

**Report suppression/cache.** The matching native report-send path now includes a 17-byte comparison to retained prior-report data, skips an unchanged report in that path, and caches the buffer when sending. Its related reset helper clears the expanded keyboard data buffer. This is static code evidence, not a measurement of bus traffic or game behavior.

The core native command-table family/count layout remains the same as v8. DeviceInfo reports the new app version. No additional named change was established in those request handlers in this pass.

## What cannot be concluded

This analysis does not establish a full list of changes to Hall scanning, ADC filtering, rapid-trigger algorithms, RGB timing, USB latency or game/console compatibility. It does not prove that any release is universally better. No claim of unchanged behavior follows solely from unchanged strings or normalized instruction sequences.

The applications do not provide the bootloader's real `08 02` writer, `08 03` validator or `08 04` return-to-app implementations. Some custom-command table counts grow through placeholders that tail-return; those slots are not proof of implemented features. The exact source tree, compiler switches and chip ordering code remain unknown.

## Reproduction and evidence

- `originals/` contains the five unchanged input containers; SHA-256 hashes are recorded in `analysis/inventory.json` and the original manifest.
- `tools/analyze_firmware.py` reproduces header/CRC validation, extracted payloads, strings, HID fields and optional linear disassembly.
- `analysis/*-disassembly.txt`, `*-string-xrefs.json`, and `usb-descriptors-decoded.json` retain byte-level coordinates.
- `protocol/native-handler-excerpts/` anchors handler findings to exact bytes and instructions. `symbols/REVIEW.md` records an independent check of the main native claims.
- `analysis/*-regions.json` and candidate-change text files are heuristic navigation aids. Region boundaries, masked call targets and address normalization limit them; they are not an exact count of changed functions.

Research labels such as HW-01 identify local observations, not machine-produced REA Evidence records. The earlier browser-code REA record is `ev_409f8e2643b0d6e5bf8c130d16b1af04ba44f5c1a0a943602f94f0baac63a636`; it covers the earlier static JavaScript tree, not these native firmware conclusions. Native analysis here used original bytes, Capstone 5.0.7, explicit descriptor parsers and localized manual tracing because a native decompiler provider was unavailable.
