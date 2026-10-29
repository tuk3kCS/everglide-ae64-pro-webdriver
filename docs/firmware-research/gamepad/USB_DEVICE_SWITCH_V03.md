# AE64 Pro v0.3: USB controller visibility, guards and validation

October 29, 2026. New image: `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.3.bin`, **136,192 bytes**, SHA-256 `c14109b2911a52fd4f8a12bf0a89d295bdf4b8c4ebb76d13083bc03f3c087b71`. This is an experimental, offline-verified successor to v0.2. It has not been flashed or tested on a physical keyboard during this work.

## Firmware-folder review

The library contains five unchanged manufacturer containers and separately named custom images. `manifest.json`, `SHA256SUMS.txt` and the server response retain the manufacturer provenance; `catalog.json` is generated for the static web driver. Factory v0.1.0.0 remains the pinned base, SHA-256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`.

The custom firmware is an append-only RISC-V extension, not a reconstruction of the entire manufacturer firmware. The native payload stays at its existing addresses. The builder links the extension at `0x8003D000`, reserves the existing 4KB state region from the stock heap, checks original instruction signatures, patches eight integration calls, redirects descriptor callbacks, and updates the container length/CRC. Build manifests list every changed original byte range. v0.3 also redirects the device-descriptor callback so both USB configurations have distinct device revisions.

`source/board/board_port.c` integrates the physical mapper, XUSB endpoints, native scan/scheduler, control dispatch and Fn-color storage/rendering. `source/src/` contains independently testable mapper, physical adapter, packet protocol, XUSB and Fn RGB code. `fn_storage.c` appends CRC-checked Fn colors to the verified unused tails of the native keymap allocations. `portable-reference/` and the top-level older ELF/manifests are historical component/v0.1 records, not the current build. v0.2 image/evidence remain unchanged; its pre-change source is archived in `history/v0.2-source.zip` with repository-relative paths. Current v0.3 ELF, build manifest and verification report are under `firmware/custom/ae64-xinput/v0.3/`.

The existing mapper's neutral/rearm, actual-calibration limits, asynchronous XUSB buffer ownership, transactional uploads and Fn persistence checks are retained. The new visibility setting uses RAM; no new flash sector, Fn trailer byte or undocumented persistent field is borrowed.

## What the new switch does

After installing v0.3, open **Gamepad mode → Xbox controller device**. Turning it off queues a controlled USB reconnect and removes XUSB interface 3 from the active USB configuration. The keyboard, consumer/mouse HID and vendor configuration interfaces remain. Turning it on restores the XUSB interface. The web driver reconnects to the same identified keyboard and checks the new state before announcing success.

| Setting | Keyboard configuration | Xbox/XInput interface | Mapping draft |
| --- | --- | --- | --- |
| Xbox controller device enabled | Original three HID interfaces | Present as fourth interface | Preserved |
| Xbox controller device disabled | Original three HID interfaces | Absent | Preserved |
| Output mode: Gamepad off | Existing USB configuration | Presence controlled by the separate switch | Preserved; sends neutral controller input |

The device switch is **session-only until power loss**. Boot defaults remain enabled for compatibility with v0.2. Mappings also remain session-only, as before. The USB reconnect briefly interrupts ordinary keyboard input. The MCU does not reboot and the driver preserves ordinary, gamepad and Fn drafts. Fn colors retain their existing flash persistence.

Windows may retain historical, non-present devices under **Show hidden devices**, as described in [Microsoft’s Device Manager guidance](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/viewing-hidden-devices). Removing an interface from active enumeration does not erase that history. The actual Windows removal/return behavior still needs physical validation.

## Source evidence and transition guards

Retained factory disassembly and `board_port.c` establish the USB descriptor and control integration:

- Original configuration: 91 bytes, three interfaces. Enabled custom configuration: 131 bytes, four interfaces, adding `FF/5D/01`, IN `0x85`, OUT `0x05`.
- Device/configuration/other-speed callbacks are in the table at payload offsets `0x19F84`, `0x19F88`, `0x19F90`. The original device descriptor lives at RAM `0x80374`; original configuration is RAM `0x80318`.
- Controller base `0xF300C000`; USBCMD `+0x140`, USBSTS `+0x144`, USBINTR `+0x148`, ENDPTPRIME/FLUSH/STAT `+0x1B0/+0x1B4/+0x1B8`. Native connect at payload `0x13DE2` sets run/stop bit 0; native reset/flush and endpoint-close paths corroborate those registers.
- Vendor replies enter the ring at RAM `0x8D2B0`. Empty head/tail indices are necessary but insufficient for acknowledgement completion: vendor IN endpoint 3 can still own DMA.
- Native keyboard/vendor writers check RAM `0x80584 == 3` before submitting. The transition temporarily sets this to nonconfigured state 1 so those writers cannot continually prime fresh transfers while endpoints are being flushed.

The implemented sequence is:

1. Validate board, protocol, exact request lengths, booleans and expected switch revision. Reject conflicting/pending requests and active gamepad/Fn uploads. Expired abandoned uploads may be released after their existing 5-second timeout.
2. Queue the reply first. Neutralize/rearm the mapper, without overwriting an in-flight XUSB packet.
3. Wait at least 30ms for the vendor reply ring to empty **and** EP3 PRIME/STAT bits to clear. Cancel without changing configuration if this does not complete within 1.5 seconds.
4. Follow the HPM disconnect preparation: clear/set run-stop, clear SOF status and check SOF on later scheduler passes. A 20ms bound prevents an endless wait.
5. Stop native writers, mask USB interrupts, stop the controller and flush endpoints. Retain transfer buffers. Remain detached for at least 250ms. Require PRIME/FLUSH/STAT to be idle before changing EP0-backed descriptor buffers.
6. On flush timeout, retain the original descriptors/configuration and restore native write eligibility. On success, select the requested descriptors and device revision (`0x0103` enabled, `0x0104` disabled), restore interrupts and reconnect. The host's native reset/configuration path cleans up and reopens endpoints.
7. Disable controller submission, OUT arming and controller-only keyboard suppression while hidden or switching. Internal callback registration happens once; repeated toggles do not accumulate interfaces.

The [official HPM USB driver](https://raw.githubusercontent.com/hpmicro/hpm_sdk/main/drivers/src/hpm_usb_drv.c) corroborates the disconnect preparation, endpoint flush and run-stop operations. Microsoft describes OS descriptors as inputs to automatic driver binding in its [OS descriptor specification](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/microsoft-os-1-0-descriptors-specification). These sources and native instructions support the implementation; they do not establish that the AE64 hardware executed it successfully.

When disabled, the compatible-ID response contains a valid 16-byte header with zero functions, so it does not advertise XUSB10. Standard descriptors retain VID/PID and original strings. Distinct device revisions help avoid sharing cached OS descriptor discovery between personalities.

## AGP1 extension

INFO retains its 20-byte shape and adds capability bit `0x08` for USB switching. Legacy firmware is gated out in the driver. Existing `0x20..0x25` mapping operations remain compatible.

All new packets use the existing 64-byte AGP1 header: family `0x10`, command, protocol 1, sequence, magic `AGP1`, status, payload length. Board ID in these payloads is little-endian `0x0030000A`.

| Command | Request payload | Successful reply payload |
| --- | --- | --- |
| `0x26` USB status | Empty | 12-byte status below |
| `0x27` Set visibility | Board ID u32, desired bool u8, reserved zero u8, expected revision u32 | 12-byte status; queued is not verified |

Status payload: board ID u32 at 0; switch protocol 1 at 4; current enabled bool at 5; target enabled bool at 6; phase at 7 (`0` idle, `1` acknowledgement/preparation, `2` detached); switch revision u32 at 8. An idle no-op retains the revision; a queued change increments it. The driver uses a transfer mutex, then identity-matched reconnect and idle state readback. A timeout, mismatched keyboard or acknowledgement alone cannot produce a success notification.

## Serial number and RGB findings

The serial-number display was a web-driver decoding error. The manufacturer converts all twelve serial bytes to concatenated decimal values; the driver now matches that format and labels Overview with S/N. Its separate fixed-width hexadecimal identity for reconnects is retained. See [serial evidence](../protocol/SERIAL_NUMBER.md).

The user clarified that the identical RGB effects occurred **only in the web preview**. v0.2 preserves the factory RGB engine, mode handler, timing loop and all 20 distinct render callbacks. The old web preview reused one fixed palette when not showing actual hardware data. The new driver renders 20 animated approximations for offline/paused/staged previews, labels them explicitly, and prevents live frames from overwriting a draft. Clean live previews still show actual received RGB. The three unlisted effects remain marked unsupported for simulation. No speculative normal-effect firmware rewrite was made. See [the RGB investigation](../fn-rgb/V03_RGB_AUDIT.md).

## Offline validation and remaining limits

The packaged image passed RV32 linking, ABI/section/RAM bounds, CRC/SHA, original-byte whitelist, every patched call and descriptor callback, trampoline continuation, native flash-helper preservation, unchanged native RGB ranges/table and 2,432 update-packet reconstruction checks.

Portable C checks passed: board integration, 3.31mm travel regression, 1,865 Fn protocol checks, 40,084 Fn storage checks, 24,727 Fn board checks and 3,359 USB switch checks. A browser client exchanged 390 packets with the compiled Fn implementation. USB tests include queue/DMA guards, no-op/stale revision handling, profile upload ownership, native writer gating, descriptor counts, suppression/rearm, missing SOF, failed flush and acknowledgement timeouts. These simulate registers; they do not validate actual MMIO self-clearing or PHY timing.

Windows Application Control blocked newly compiled native test executables. Portable C tests were instead compiled for wasm32-wasi and run using Node's WASI runtime, with no USB/network imports or filesystem preopens. This is recorded in `verification.json`; native RV32 code was separately compiled and audited. No security settings were changed.

Physical boot, high-speed detach/reattach, host reset ordering, active Device Manager removal, sustained endpoint traffic and recovery remain unverified. If the transition cannot be confirmed, the UI requests reconnect/readback and does not claim success. A power cycle restores the default enabled state. Selecting the new image in Firmware only prepares it; flashing still requires the existing review and explicit Start action.

Rebuild with `source/build.py`; verify with `source/verify.py --wasi` when using the portable test runtime. Both require the pinned factory image and Zig path documented in the custom firmware README. When verifying this release layout, pass `--image firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.3.bin --image-dir firmware/custom/ae64-xinput/v0.3` because the binary is kept outside the evidence directory to avoid duplicate catalog entries. v0.2 remains available for comparison or an explicit rollback through the existing updater.
