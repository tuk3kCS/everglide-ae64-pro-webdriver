# v0.5: simultaneous controller keys

October 29, 2026. Image: `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.5.bin`, **138,040 bytes**, SHA-256 `78cd833f4af6d57e37eaf5d5e7f66449fe4ba5cd2ed59d359ba15407a419c206`.

## Observed on the connected keyboard

Read-only AGP1 configuration reads found controller-only mode with W → left-stick up, A → left, S → down and D → right. All four use a 0.20–3.20mm window, calibrated maximum 3.31mm, linear curves and circular output. The saved configuration is valid.

A 35-second recording compared native travel queries with Windows XInput while the user performed the requested press sequences:

- W first, then A: W reached about 3.28mm, A remained zero, XInput stayed `(0, 32767)`.
- A first, then W: both distances reached about 3.28mm, XInput reached `(-23166, 23166)`. A's distance then remained frozen while W was held.
- S first, then D: S updated while D remained zero. D updated when pressed alone later.

These are observations of the faulty running firmware. The queries did not change mappings, calibration, USB visibility or firmware. The firmware already combines two valid axes correctly; the later matrix positions were not getting fresh scan data.

## Cause and correction

The retained stock v0.1.0.0 disassembly shows that its scanner, payload offsets `0x5ECE..0x6CD2`, updates keys in matrix order. At `0x6BB6..0x6C0A` it compares each computed event with the event byte at record offset `+9`, stores a changed event and returns immediately. The next pass progresses beyond that key once its event stabilizes. Normal press/held events include 5 and 2; release transitions include 11 and 0.

The custom controller-only suppression cleared `record+9` after each scan so the keyboard report would omit mapped keys. That same byte is the native scanner's event history. A held mapped key therefore appeared to change on every pass. The scanner repeatedly returned at that key and starved later matrix positions. W precedes A; S precedes D. A direction pressed earlier could remain frozen rather than disappear, explaining the order-dependent diagonals.

v0.5 remembers each suppressed native event and restores it immediately before the next native scan. After scanning it captures travel and stock latches, remembers the updated native event and again suppresses the keyboard-facing event before the stock scheduler runs. This preserves the scanner's progress while retaining controller-only keyboard suppression. It does not change axis combination, opposing-direction policy, native calibration or the native scanner itself.

Restoration skips records that already contain a newer nonzero native event. A changed onboard profile discards old history; the native profile-load hook restores/clears pending history before the loader replaces records. Mixed mode and disabled mapping return to native event handling. The saved GPR1 format is unchanged, so valid v0.4 mappings remain readable.

## Validation and remaining physical check

`test_rollover.c` models the native scanner's event-change early return rather than the previous no-op scan stub. The archived v0.4 board port fails the new two-key regression. The corrected port passes all 12 ordered WASD pairs with both release orders, full diagonals, opposite directions, changing partial travel, held-input stability, unmapped keys, mixed/controller-only transitions, newer native events and profile-history guards: **548,865 checks**.

The WASI runner now propagates the C program's exit status; the intentionally failing v0.4 regression exits nonzero. All existing C board, calibrated-range, Fn protocol/storage/board, gamepad storage/board and USB switch suites pass with the fixed runner. The browser-client/C-firmware exchange passes 390 packets. The image audit checks CRC/SHA, bank/RAM bounds, hooks/trampolines, descriptors, original-byte preservation, unchanged native RGB ranges and 2,465 flash packets. State remains within the existing 4KB allocation. Release evidence and source hashes are in `firmware/custom/ae64-xinput/v0.5/`; the prior source is archived in `history/v0.4-source.zip`.

**v0.5 has been built and verified offline; it has not been flashed or physically validated during this work.** After flashing, release every mapped key to arm input, read the active profile and repeat W→A, A→W, S→D and D→S, including releasing either key while holding the other. Both press orders should produce diagonals, and releasing either direction should immediately leave the other direction active.

The driver selects v0.5 from Gamepad mode → Hardware Solution → Choose hardware firmware. The Firmware tab also lists it directly. Export the current mapping before upgrading; verify the saved mapping afterward and apply the desired draft if needed. Existing v0.4 mapping persistence, Fn colors and the session-only Xbox USB visibility switch are retained. This change addresses the observed scan starvation; unrelated USB transfer faults remain outside this finding.
