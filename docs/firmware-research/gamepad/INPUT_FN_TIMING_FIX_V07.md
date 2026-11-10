# v0.7: physical keyboard-output gates, momentary Fn and hardware timing

This report records v0.7. Its binary and build evidence are in Git history, and its [source archive](../../../firmware/custom/ae64-xinput/history/v0.7-source.zip) is in the repository. See the [current firmware guide](../../../firmware/custom/ae64-xinput/README.md) for build and update instructions.

October 31, 2026. Image: `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.7.bin`, **140,104 bytes**, SHA-256 `8c3df91f94c376a403c100f18108efccf16c5b397c0101a9e3427f46314b3524`.

## Reports and investigation boundary

The user tested v0.6 with WASD on the left stick, T on left trigger and controller-only assignments. Rapidly tapping A still typed A in Windows. They also reported approximately 0.7–0.8 seconds before custom Fn1 LEDs appeared, and Fn2/Fn3 lighting **and keybindings** remaining active after release until Fn1 was used. Fn1 was confirmed to be a direct assignment, not an advanced tap/hold action.

These are user-observed hardware results. This investigation used the pinned stock binary, retained RV32 disassembly, current extension source and offline execution/tests. No device settings or firmware were written. No connected matching keyboard was available to the read-only device query during this work. The exact physical spam sequence and wall-clock LED delay were not measured locally.

The native evidence is pinned to factory v0.1.0.0, SHA-256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`. All offsets below are payload offsets at CPU base `0x80021000`.

## 1. Block mapped normal input before it enters the keyboard ledger

v0.6 rewrote post-scan events to release 11 and requested keyboard report retries. Those measures can clear stale held input but do not constitute a gate on every native keyboard append. The native action processor can enqueue intermediate reports at `0x57C0/0x57CC`; the direct helper at `0x5B28` can append, compose and send at `0x5B7A/0x5B7E/0x5B82`. A filter only before the final main-loop send misses those paths.

v0.7 gates the common normal-key/modifier append at `0x46EE`, using the **actual physical key-record context**. Context is captured in the ordinary per-record path at `0x56BC` (`s0`) and in the earlier timed-key sweep at `0x573A` (`s11`). The main action wrapper at `0x6E20` clears context on entry/exit. A scoped wrapper at `0x5B28` derives the same context from its record argument. Thus mapped physical sources are blocked before a normal usage can enter an intermediate report. The prior post-scan release and scan-history mechanisms remain.

The native ledger's source byte is not a unique matrix index: the examined action processor computes an equivalent of `(row+1)*(col+1)`. Different physical keys can share that token. Filtering by usage or that token would incorrectly affect an unbound key remapped to the same letter. Both append and removal (`0x484A`) now use unique physical IDs 1–64 **only when exact physical context is known**. Context-free owners, including native macro owner 240, retain their original values. The bounded source-byte audit found exact-pair deduplication/removal and ledger cloning; HID report encoding uses the usage byte, not the owner byte.

Mixed/off modes and the completed keyboard-only USB persona retain normal physical keyboard output. Ordinary keys/modifiers, aliases and timed/direct normal-key paths are covered. Media/mouse actions and arbitrary macro activation/playback have separate paths and are not claimed universally suppressed by this normal-key guard.

## 2. Retain the Fn action that was actually pressed

The action processor copies active Fn layer `0x82B9D` to its previous snapshot `0x82B9C`, then resolves each key through that layer (`0x57EC..0x5802`). Only Transparent action 1 falls through to lower layers. A Main key mapped to Fn2 can therefore resolve to an ordinary action in its own Fn2 layer when released. That bypasses Fn release and leaves the layer active. Native Fn1 release clears higher held-layer entries, which explains the reported recovery using Fn1.

The factory driver avoids this by placing Transparent on the trigger's higher layers. The webdriver now applies that guard to newly staged Fn assignments, imports and Apply/review paths, while leaving unrelated unstaged onboard mappings untouched. The staged changes are included in the normal review/write/readback workflow.

Firmware also protects existing saved layouts. At `0x57F4`, it records the resolved Fn1–Fn3 press action by physical source and retains it through hold/release, independent of the current layer's mapping. Native Fn release consumes idle event **0**, whereas ordinary keyboard removal consumes **11**. A canonical release of a tracked Fn trigger is passed to the native Fn release path with the original Fn action and idle event 0. Remaining held Fn origins are reconciled afterward, including duplicate triggers, overlapping layers and a profile change while a trigger is held. Controller-only sources cannot activate Fn through this resolver.

## 3. Request a prompt Fn lighting frame

The custom overlay runs inside the existing native RGB compositor and uses its normal output/DMA path. On a real Fn layer transition, the extension sets the native frame deadline `0x8D260` to zero. The next native lighting-task pass can compose the appropriate Fn/main frame immediately. Fn color installation and native profile loads also request a frame. Normal main/strip animation deadlines `0x8D264/0x8D268` are retained.

The native compositor loop uses a 10ms frame deadline. No deliberate 700–800ms Fn delay was found in the overlay or that frame limiter. The new deadline request removes an avoidable scheduling wait, and corrected controller timing reduces unnecessary task pressure, but the user's exact physical LED delay remains a hardware-retest item. The compositor is not called directly from the input task, avoiding a second caller racing its output/DMA state.

## 4. Use verified milliseconds instead of a busy-loop/RTOS counter

Earlier builds linked `stock_tick` to `0x80031706`, reading `0x8D320`. Native `0xD9D0..0xD9D8` calls the RGB task, calls `0x10710` to increment that counter and repeats. It is not a calibrated wall-clock millisecond value. Prior descriptions of fixed 1ms report limits or 50ms retries in those builds were therefore inaccurate.

v0.7 links to `0x80033B92`, which reads `0x8D2F4`. Timer initialization `0xE6AA..0xE728` obtains its clock frequency, divides by **1000**, and configures GPTMR channel 1; the interrupt at `0x636..0x656` increments this counter on its reload interrupt. Static image verification pins both accessor and divisor instructions.

Controller reports now target **one submission per real millisecond (up to 1,000/s)**, subject to scheduler availability and transfer completion. The USB high-speed endpoint still advertises a 125µs polling opportunity; that does not imply 8,000 freshly submitted controller reports per second. The 50ms keyboard-state retry, watchdogs, USB-switch waits and transaction timeouts now use actual milliseconds. Sustained physical USB/report rate and end-to-end latency remain unmeasured.

## Verification

- A native-output-phase model fails with archived v0.6 source and passes with v0.7. It exercises **6,000 rapid WASD/T press/release cycles**, normal append attempts after scan suppression, direct/timed contexts, an unbound same-letter alias with a colliding native owner, modifiers and mode changes. Fn tests cover all three layers on every unbound physical key, overridden trigger mappings, duplicate/overlapping triggers, missing release processing and profile changes: **4,378,935 checks**.
- Independent hardware-clock tests freeze milliseconds while busy-loop ticks advance, test the 1ms send gate, in-flight packet ownership, the real 50ms watchdog and 32-bit clock wrap: **15,091 checks**.
- An independent dependency-free RV32I/C interpreter executes the **actual linked bytes** of the three injected register-preserving trampolines. **96 variants** verify every register except its intended result, SP/RA, exact 64-byte save areas/guards, 16-byte C-call alignment, C arguments and unsigned LBU/LHU behavior, even when the simulated C helper destroys every ABI-volatile register. Idle paths are verified to skip C entirely (3 instructions for an ordinary record with no event; 5 for a non-timed key), avoiding unnecessary task pressure.
- All existing controller, storage, Fn/RGB, USB lifecycle, scanner-history and keyboard-release C suites pass. Browser-client/C Fn protocol testing passes 390 packets. All **20 JavaScript suites** pass, including the new Fn mapping inheritance test and complete firmware packaging.
- Static image checks verify all 15 instruction/call hooks, descriptor callbacks, trampolines, real-clock binding, CRC/SHA, original-byte preservation outside declared patches, native RGB engine preservation, reserved RAM, ABI and 2,502 complete-image flash packets. BSS remains **3,920 bytes** within the existing 4,096-byte reservation.

Release metadata, ELF, exact source hashes, image audit, regression comparison and assembly-interpreter evidence are in `firmware/custom/ae64-xinput/v0.7/`. The v0.6 image is unchanged, with its source archived in `history/v0.6-source.zip`. Tests model native input phases and execute the injected assembly boundary; they do not emulate the complete MCU/USB/RGB hardware.

## Install and physically verify

Refresh the local driver, choose v0.7 in Firmware and flash using the existing reviewed updater. Release all mapped keys after restart. Saved gamepad/Fn formats remain compatible. Existing Fn trigger layouts are supported by firmware origin tracking; new assignments also receive the frontend transparency guard.

Retest WASD plus T in controller-only mode by rapidly pressing A, then test an unrelated ordinary key. Test Fn1–Fn3 press, hold and release, including Fn2/Fn3 without touching Fn1 afterward. Verify both keybindings and LEDs return to Main, and compare the direct Fn1 transition delay. **This new image has not been flashed or physically validated during this work.**
