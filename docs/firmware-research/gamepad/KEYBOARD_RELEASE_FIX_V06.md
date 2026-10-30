# v0.6: release normal keyboard input from controller-mapped keys

October 30, 2026. Image: `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.6.bin`, **138,480 bytes**, SHA-256 `ea90ac6b1613915fbd87edebd85b7be4631fb3c7e4bb06bff5e190315de6863b`.

## Report and evidence

The user physically tested v0.5 and confirmed that simultaneous controller directions now work. They also reported intermittent repeated normal letters from controller-mapped WASD keys; pressing Backspace stops the visible repetition. The exact spontaneous hardware trigger was not reproduced during this work. No firmware or settings were written to the keyboard.

The pinned stock v0.1.0.0 disassembly establishes a separate normal keyboard held-key list. Generic key handling distinguishes press event 1, held event 2 and release event 11 (`0x5824..0x583C`, `0x5946..0x595E`, `0x59B4..0x5A54`). Keyboard press/remove routines update that list, and `0x4994..0x4BD0` rebuilds boot/NKRO reports from it. An idle event 0 does not substitute for the generic-key release path.

v0.5 set mapped keys' output events to zero and requested event processing globally. That prevents a fresh normal press in the usual case, but does not guarantee removal of a key already in the normal held-key list. If its per-key pending flag was already consumed, merely requesting global processing also does not force that key through the release path. Applying controller-only mappings while a normal key is held is one deterministic simulated example.

Backspace stopping visible repetition is consistent with this mechanism: another key can take the operating system's repeat selection while the earlier key remains logically held. It does not prove that the older key received a release, nor does it identify the exact intermittent trigger.

## Correction

After capturing physical travel and canonical normal/RT latches for the controller, each mapped key in controller-only mode receives the native **release event 11** and its per-key **pending flag 0x80**. The native event processor can now remove its normal held state even if its current scanner event is already idle or its previous pending event was consumed.

The v0.5 scan-history fix remains: each original scanner event is remembered, restored only immediately before the next native scan, then replaced with the keyboard-facing release afterward. Restoration recognizes the injected release byte and preserves newer native events and profile isolation. Synthetic releases do not change the controller's captured canonical latch or travel.

Keyboard suppression now follows validated assignments, controller-only output mode and the actual enabled USB persona. It no longer disappears when a saved analog interval temporarily exceeds a switch's reported maximum, a maximum becomes unavailable, or the USB-switch ACK/detach handshake is pending. Such sensor faults still neutralize controller output. A completed keyboard-only USB persona, mixed mode and output-off mode retain native keyboard input.

The native ring push at `0x12962..0x129A8` has no full-queue rejection. To recover if a release packet is overwritten, v0.6 asks the native scheduler to resend its current keyboard state at most every **50ms**, while controller-only suppression is active and USB is running. It uses only the selected boot/NKRO format (`0x8D2D4` bit `0x100`), preserving held unrelated keys. NKRO retries invalidate the native last-queued-image comparison flag (`0x8D200`, checked at `0x54F8..0x5514`) so an identical retry is not discarded before transmission. Consumer/mouse flags, queued packet contents and DMA-owned buffers remain untouched. Suspend and USB switching pause the resend. A permanently stalled USB transport is outside this recovery mechanism.

The mapping/storage format, saved profile compatibility, native RGB engine and existing USB DMA ownership rules are unchanged. The USB persona revisions are `0x0109` enabled and `0x010A` keyboard-only.

## Validation

The new `test_keyboard_release.c` exercises the independent held-key list and pending-event gate. It fails with the archived v0.5 board source and passes with the fix: **197,333 checks**. Cases cover all WASD keys when held or already physically idle, consumed pending flags, repeated updates, Backspace changing repeat selection without releasing the old key, unrelated Backspace/Shift/ordinary keys, digital controller latch passthrough, invalid calibration/ranges and mixed/off mode behavior. Lost-release tests cover both boot and NKRO, their format selection, NKRO deduplication, the 50ms cadence, unbound held keys, consumer/mouse flag preservation, suspend/resume and unavailable USB.

The scanner-history regression still passes all ordered WASD press/release pairs, opposite directions, diagonals, changing analog depth and profile guards: **584,785 checks**. The USB-switch suite additionally checks that a pending ACK does not turn mapped keys into typing. Existing board, range, Fn protocol/storage/board, gamepad storage/board and USB lifecycle suites pass. The browser-client/C exchange passes 390 Fn packets. Image checks cover CRC/SHA, original-byte preservation, unchanged native RGB ranges, hooks/trampolines, RV32 ABI, RAM/bank bounds and 2,473 complete-image flash packets.

Evidence is in `firmware/custom/ae64-xinput/v0.6/`; the untouched v0.5 image and its source archive remain available. The new tests model the native normal-key processing contract. They do not emulate the complete MCU/USB stack or validate every custom macro/advanced key-action combination.

**This build is verified offline, not flashed or physically validated during this work.** The source-proven stale-key path is corrected; the user's exact intermittent hardware sequence remains unconfirmed. Refresh the driver, select v0.6 in Firmware, flash it, release all mapped keys and verify ordinary typing stays absent while the controller responds. Keep a mapping export before upgrading. If repetition returns, recording the output mode, onboard profile and whether Apply, reconnect or USB visibility changed immediately beforehand will help distinguish remaining paths.
