# Native Windows XInput: implementation and remaining board port

Status: compiled/tested portable components and an independent configuration editor. **No linked, flashable AE64 Pro application has been produced. Native Windows XInput enumeration has not been demonstrated.** The user confirmed native XInput is required and that no debugger or confirmed recovery procedure is available.

## Implemented

- Independent LT/RT analog mapping, each clamped to a physical start/full-output range.
- All eight directions of the two sticks, per-binding physical ranges, linear/smooth response, opposition policy and circular/square output.
- ABXY, bumpers, stick clicks, Back/Start and D-pad using existing keyboard pressed/RT states through the physical adapter.
- Neutral/rearm on mode, profile revision, calibration change, faults and stale frames; bound-key suppression masks for controller-only assignments.
- A custom AGP1 configuration protocol with board/capability identity, explicit serialization, per-transaction ownership, CRC, timeout, atomic install callback and read-back verification.
- Original portable XUSB interface/OS-binding descriptors, 20-byte input encoding, bounded control responses, asynchronous IN buffer ownership and OUT packet parsing.
- Gamepad Studio in the existing independent webdriver repository: physical layout, ranges, controller visualization, local drafts, import/export and capability-gated Apply. Stock firmware can be used only for explicit read-only travel previews.

LT/RT are 8-bit 0–255. XInput stick coordinates are signed 16-bit, so they preserve the standard controller precision while following the same physical travel clamp. Digital controls do not get a second independent analog actuation threshold.

## Connect the pieces in the target firmware

1. **Establish target and storage.** Confirm the chip identity and execution/memory map. Reserve actual SRAM for mapper, staging, XUSB IN/OUT and queue state. The apparent space between current BSS and stack is not proven free. Obtain a reproducible backup/recovery path before replacing the application.
2. **Sample after the stock producer.** In stock v0.1.0.0, payload call site `0x6E08` reaches the travel producer at `0x5ECE`. The record layout/producer and exact instructions are retained in PATCH_FEASIBILITY.md. A trampoline could call the original routine then the new mapper, but its ABI and lifetime must be proven. Translate the independent driver's physical indices into actual matrix records and convert the calibrated route units into micrometers only after confirming the stock scale/validity path.
3. **Use canonical digital states.** Feed `gp_physical_frame.stock_pressed` from the keyboard's actual per-key pressed/RT state after the appropriate processing step. Browser key events and guessed fixed thresholds are not substitutes. Apply the suppression mask to the keyboard output path and send releases for previously held keys on transitions. Keep unrelated keyboard/consumer/mouse traffic working.
4. **Register native XUSB.** Add an actual vendor-specific `FF/5D/01` interface, dedicated IN/OUT endpoints, full composite configuration/other-speed descriptors and EP0 callbacks for OS descriptors. Compose the portable fragment using a confirmed interface and free endpoint allocation; the sample endpoint numbers in tests are not verified hardware assignments. Preserve the vendor WebHID collection for configuration.
5. **Use a real 20-byte transmit path.** The existing keyboard ring uses fixed 17-byte records and cannot carry the XUSB report. Register completion events, own persistent/DMA-compatible buffers and provide bounded backpressure. The XUSB component calls a supplied `start_in` function; it does not initialize or register the controller hardware. Re-arm a persistent OUT buffer after processing rumble/LED requests. Keyboard hardware need not physically rumble, but the transport still needs valid handling.
6. **Install configuration in one control-task context.** Intercept AGP1 commands before the stock Handle-family bounds check, or implement the new family in a real port. The stock family has only one return slot and cannot reach these new handlers unchanged. Pass the actual monotonic clock to `gp_vendor_handle`. The install callback must validate calibration coherently, neutralize/rearm, install mappings atomically and persist only in a known safe region. Advertise native XInput/persistence capabilities only when those integrations are active.
7. **Link a complete application.** Link the module library with the correct board startup, linker script, USB stack and runtime (including required memory helpers). Review ELF/map and all protected ranges. `libae64_gamepad.rv32.a` is a component archive, not an application payload or update container.
8. **Package only a valid application.** After integration, use the earlier research packer to wrap the complete application payload with the known board header and CRC. A correct CRC proves byte integrity, not USB operation, image acceptance or recovery.
9. **Verify actual Windows binding.** With Steam/virtual-controller bridges closed, check that the AE64's XUSB interface binds under its own identity and `XInputGetState` reports its controls. Correlate USB identity and controller slot by controlled connection/removal or a suitable device API; an unrelated controller in an XInput slot is not proof. Exercise simultaneous triggers, all stick directions, buttons, reconnect, suspend/resume and fault releases. Windows may cache descriptor discovery for the original VID/PID/revision; do not impersonate a different manufacturer's device to hide integration problems.

The source-level facts behind steps 2–5 and the unresolved parts are tabulated in PATCH_FEASIBILITY.md. The exact original app SHA-256 and byte excerpts are retained. No hardware-specific addresses are compiled into the portable components, and no guessed firmware image is distributed.

## Rebuild the delivered components

From the firmware source directory, with an official portable Zig compiler and Node.js available:

```powershell
python build.py --zig C:\tools\zig\zig.exe --out build --webdriver C:\GitHub\everglide-ae64-pro-webdriver
```

This compiles/runs host tests and the C/JavaScript protocol harness, then compiles four RV32 relocatable objects and archives `libae64_gamepad.rv32.a`. It deliberately contains no flash step and creates no update `.bin`. The optional `--webdriver` argument runs the matching browser-model/client tests; omit it for C-only checks.

The tested compiler was official SHA-256-verified Zig 0.17.0. RV32 flags used are `-target riscv32-freestanding-none -mcpu=generic_rv32+m+a+c -mabi=ilp32 -ffreestanding -fno-builtin -Os`. The future complete HPM board build must use flags compatible with its confirmed SDK and chip, rather than assuming a component object proves that platform.

## Scope of verification

Offline checks cover bounded arithmetic, physical range endpoints, simultaneous controls, stock digital-state passthrough, lifecycle neutralization, malformed/mixed-owner transfers, descriptor lengths and control bounds, golden packet layout and asynchronous buffer ownership. RV32 compilation checks instruction target/ABI at object level. None of these executes the custom application on the keyboard or verifies Windows driver binding.
