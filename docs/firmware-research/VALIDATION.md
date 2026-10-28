# Validation performed

Date: October 28, 2026. All checks below were offline. No firmware update, boot transition, erase command, validation request, reboot or custom application execution was sent to the keyboard during this investigation.

## Original image and protocol checks: PASS

- All five original SHA-256 hashes match the extraction manifest.
- All five magic/board/header-boundary/length fields match the observed format.
- Every payload's CRC-32 matches the stored header value.
- Extracting and repackaging each original reproduces it byte for byte.
- Deliberate payload corruption and a wrong board ID are rejected.
- Every generated packet has the correct 64-byte payload size, family/command, file offset, length and padding; concatenating packet data reconstructs the complete container.
- Packet counts and whole-stream hashes match the isolated vendor packet builder for every packet of all five originals.

Reproduce with `python protocol/test_offline.py originals` and `python tools/verify_evidence.py`. The former runs three grouped tests; the latter runs four evidence tests.

## Static evidence checks: PASS

- The portable inventory/descriptor/disassembly script ran successfully across all five originals using Capstone 5.0.7.
- Descriptor parsing verifies shared Report ID 1 input lengths of 120/120/120/120/128 bits and LED outputs only in the last two shared descriptors.
- Separate boot-keyboard, vendor HID and USB device descriptors compare byte-identically across the five files.
- Saved HID descriptor bytes match their recorded original-payload offsets.
- Recorded exception-stop routine bytes match each corresponding original.
- Native handler excerpt instruction bytes match their original payload offsets.
- Retained vendor JavaScript snippets match their recorded SHA-256 hashes.
- Independent review of the important handler/descriptor changes is recorded in `symbols/REVIEW.md`.
- Startup memory-map and MMIO-candidate tools reproduced the retained results. Their address/section naming limitations are documented in the hardware reports.

Linear disassembly can interpret data as instructions, does not resolve every indirect branch, and does not automatically assign execution addresses to startup-copied ILM code. Exact/fuzzy normalized region matches are exploratory aids, not proofs of semantic equivalence or complete function boundaries. No native decompiler provider was available, and recovered instructions are not the original C source.

## New C module host behavior tests: PASS

The new, portable fixed-threshold hysteresis module was compiled using C11, optimization and strict warnings. Executed tests cover press/release boundaries, noise in the hysteresis band, full travel sweeps, independent key states, invalid configurations and saturation. Assertions are explicitly enabled.

These tests exercise the standalone algorithm on the development computer. They do not validate ADC wiring, sensor calibration, task/interrupt timing, USB reports or keyboard hardware.

## Isolated RV32 cross-compile: PASS

The same module compiled with a SHA-256-verified official Zig 0.17.0 compiler to an ELF32 little-endian RISC-V relocatable object (machine 243, compressed instructions, soft-float ABI). Its object hash, source hash and exact architecture attribute are recorded in `development/hpm-port-template/rv32-compile-evidence.json`.

The compiler archive provenance is in `toolchain-provenance.json`. This was an isolated module build, not a complete HPM SDK board build. The object remains an intermediate work artifact and is not supplied as a flashable image.

## Not validated

The exact chip ordering code, board pins, full flash/calibration backup, electrical recovery procedure, bootloader image/acceptance, complete firmware port, target timing, live flash sequence and booting a custom application remain unvalidated. CRC/container/packet success is not evidence for these properties.

The final ZIP was checked for archive corruption and for byte-identical original input members. `BUNDLE_SHA256SUMS.txt` inventories the included deliverable files except itself.
