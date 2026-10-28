# Stock v0.1.0.0 patch feasibility: native controller output

The calibrated-travel producer and a concrete post-scan hook have been recovered. A bounded experimental **generic HID** patch has a plausible path through the existing multi-report endpoint. That path does **not** fulfill the requested native Windows Xbox/XInput behavior. XInput requires an additional XUSB USB personality and control/endpoint integration that has not yet been established in this stock image.

Original portable XUSB wire-format/control code and offline tests are now provided in `include/ae64_xusb.h`, `src/ae64_xusb.c`, and `tests/test_xusb.c`. They compile on Windows and to an ELF32 RISC-V object. They do not register USB hardware or constitute a flashable keyboard firmware.

No mode switch, flash operation or other keyboard command was executed for this work. No speculative custom `.bin` was generated.

## Native interfaces now established

All instruction offsets below refer to the **v0.1.0.0 payload**. Add `0x1000` for the original container offset, or `0x80021000` for the linked instruction address. Exact excerpts are retained under `stock-evidence/`.

### Hall travel producer and post-scan placement

The scan/processing function begins at payload `0x5ECE`. Its loop traverses 6 rows and 21 candidate columns. The runtime record address remains:

```text
0x00082BB8 + row * 0x5E8 + column * 0x48
```

The computed travel value is stored at record offset `0x1A` by the instruction at payload `0x63EE`. Its inactive/reset branch clears that field at `0x669C`. Row/column loop advancement occurs at `0x6C86–0x6CC2`. These paths corroborate that the vendor travel-query response reads a value produced by this scanner, rather than an unrelated settings field.

Function `0x6DEC` calls this producer at `0x6E08`, performs stock keyboard/event work, and calls the report scheduler `0x53F4` at `0x6E60`. The enclosing main loop calls `0x6DEC` at `0xD8AC`.

A version-specific trampoline at the **single call site `0x6E08`** is therefore a plausible post-scan hook: call the original function at linked address `0x80026ECE`, then consume travel values and return to the original caller. This is a concrete candidate, not a validated patch. The wrapper must preserve the actual RISC-V calling convention, GP, stack alignment, callee-saved registers and return address, and tolerate the producer's early exits during calibration/state transitions.

The scanner's scheduling frequency, timer units, timing budget and all concurrent data producers have not been proven. Travel normalization must use the key's actual calibrated range and validity state; raw ADC or an assumed fixed 4 mm range is insufficient.

### Existing fixed-size queue and data lifetime

The ring API is recovered at these entries:

| Payload offset | Static behavior |
| --- | --- |
| `0x12952` | Initialize queue indices, capacity, item size and backing pointer |
| `0x12962` | Copy one item synchronously into backing storage and advance write index |
| `0x129AA` | Copy one item into caller buffer and advance read index; return 1/0 |
| `0x12A02` | Test whether indices differ |

The eight-byte control structure has write index at byte 0, read index at byte 1, capacity at byte 2, item size at byte 3, and backing pointer at byte 4. `0x12962` contains **no queue-full check**. A producer that wraps onto the reader can overwrite or make the ring appear empty.

The stock NKRO/multi-report queue at RAM `0x0008D21C` is initialized at `0x51A0` with capacity 8, item size **17 bytes**, and backing storage `GP - 0x268 = 0x00080898`. It copies the caller's bytes before returning, so a stack buffer has sufficient lifetime for the enqueue operation itself.

At `0xB7AC`, the consumer copies a queued item into the persistent buffer at `GP + 0x5C8 = 0x000810C8`. It calls a USB-write wrapper with that buffer and length 17 at `0xB7C2`. This wrapper reaches `0xEB44`, checks configured USB state, and calls `0xF2E4` with `(bus 0, endpoint 0x82, pointer, length)`. The examined consumer does not branch on the report-ID byte.

Thus a deliberately **17-byte HID report including an unused report ID** could potentially share this queue and endpoint. It would need queue-full handling, pacing, synchronization and arbitration with the stock keyboard producer. The XUSB input packet is **20 bytes with no HID report ID**, so it cannot safely use this 17-byte ring by changing only the first byte or advertised descriptor.

The existing persistent dequeue buffer remains in use until endpoint completion. Bypassing the queue and passing a temporary stack buffer to the low-level write routine is not established safe. The wrapper at `0xEB44` also discards the underlying write result and returns 1 after calling it; an integration must not equate that wrapper return with confirmed USB transfer completion.

### Descriptor relocation

The ordinary multi-report HID descriptor is at payload `0x19EA4`, length 157 (`0x9D`), registered through:

- `0xE9F4` and `0xEA00`: descriptor pointer `0x8003AEA4`.
- `0xE9FC`: descriptor length `0x9D`.
- `0xEA0A`: interface-initializer call, target `0xEBCE`.

The descriptor is followed closely by another descriptor, so an appended collection cannot be assumed to fit inline. A generic-HID experiment could relocate a longer descriptor and patch its pointer/length. It still needs report generation and transfer scheduling. This change would not introduce XUSB class enumeration.

### RAM and flash placement remain bounded questions

The latest startup zeroes ordinary BSS through `0x0008D388`; initial SP is `0x00098C00`. The apparent gap is **not established free SRAM**. Static thread stacks, RTOS heap, context frames, interrupt stacks and DMA buffers must be mapped before reserving permanent mapping state or USB buffers. Extending BSS requires updating every affected startup/heap/thread boundary, not just placing an address after the current end.

Appended code or descriptors similarly require verified application limits, bootloader acceptance, linker placement and preservation of startup-copied ILM/flash-service regions. The stock boot-entry path stages a 256 KiB region and writes a boot marker before reset. Neither unused header bytes nor an apparent run of zero bytes is established executable/free storage.

### Keyboard suppression is a separate path

Travel production, digital event processing, and report queueing occur at different points. Controller-only mode must suppress the selected keyboard outputs **and release any already held outputs**; skipping the entire report scheduler would also interfere with unrelated keyboard, consumer/system/mouse state and potentially release packets.

One control-plane option is a dedicated ordinary keyboard profile in which controller-bound keys have Empty mappings, restored on mode exit. That uses the existing mapping protocol, but profile switching/release behavior must be validated. A native selective filter must identify key-event emitters and their release semantics before being patched. This focused pass establishes neither a complete filter nor its transition tests.

## What native Windows XInput additionally requires

The Keychron primary source at commit `2b493ff95f2665db719b1e95c91babb5036e72f3` provides a useful reference implementation boundary:

1. [`usb_descriptor.c`](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/tmk_core/protocol/usb_descriptor.c) defines a separate vendor-specific interface, class `FF`, subclass `5D`, protocol `01`, its class-specific descriptor, and both interrupt-IN and interrupt-OUT endpoints. It exposes the Microsoft OS string at index `EE` and an Extended Compatible ID containing `XUSB10` for the selected interface.
2. [`usb_main.c`](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/tmk_core/protocol/chibios/usb_main.c) routes the Microsoft vendor descriptor request through its EP0 request handler and sends controller packets on a dedicated XInput endpoint.
3. [`report.h`](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/tmk_core/protocol/report.h) defines the USB packet as type/length, the controller fields, and six reserved bytes: **20 bytes total**. This differs from Microsoft's 12-byte `XINPUT_GAMEPAD` API structure.
4. [`usb_descriptor_override.c`](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/keyboards/keychron/common/analog_matrix/usb_descriptor_override.c) deliberately changes descriptors when toggling controller personalities. Mode selection affects enumeration, rather than only setting a report flag.

Microsoft distinguishes the XUSB kernel interface used by XInput from the HID interface exposed for DirectInput compatibility. Adding a generic HID Game Pad collection therefore does not establish native XInput support. [Microsoft: DirectInput and XUSB devices](https://learn.microsoft.com/en-us/windows/win32/xinput/directinput-and-xusb-devices).

Retained source URLs, blob identities and selected primary-source excerpts are in `stock-evidence/keychron-xusb-reference.json`.

### Gaps between that reference and the AE64 patch

| Required integration | Evidence available | Still required |
| --- | --- | --- |
| Analog mapping | Stock travel producer, post-scan call, portable mapping core | Safe hook/ABI, physical key map, calibrated validity and timing validation |
| Composite XUSB configuration | Reference interface wire format; stock HID registration sites | Full configuration/other-speed descriptors, interface count/length, stock class registration ABI |
| Windows binding descriptors | Portable MSFT100/XUSB10 responder implemented | Actual EP0 callback registration, request dispatch, Windows cache/binding test with AE64 identity |
| IN transfer | Stock endpoint writer and queue behavior traced | A 20-byte persistent buffer/queue and completion ownership for a selected XUSB endpoint |
| OUT transfer | Portable rumble/LED parser implemented | Endpoint allocation, persistent OUT buffer, receive callback and rearming |
| Mode/configuration | Existing vendor channel and profile mechanics | Implemented custom commands, SRAM ownership, persistence/rollback and all-keys-up transitions |
| Native XInput validation | Offline packet/descriptor tests | Windows driver binds under `1CA6:300A`; `XInputGetState` reads analog values; disconnect/reset/suspend tests |
| Flash and recovery | Stock container checks and host flash protocol | Bootloader custom-image acceptance and separately verified recovery path |

Preserving VID `1CA6` and PID `300A` avoids impersonating an unrelated controller. It does not by itself guarantee Windows will query new OS descriptors or bind the XUSB driver. Windows may cache descriptor discovery under the existing device identity/revision; assigning and testing an appropriate custom revision belongs in the board port. No Xbox-console authentication support is claimed.

## Portable XUSB backend delivered

`ae64_xusb.c` implements original, USB-stack-independent code for:

- A 40-byte XUSB interface fragment with configurable interface number, IN/OUT endpoint addresses and polling intervals.
- An AE64 identity descriptor retaining `1CA6:300A`.
- Microsoft OS string `MSFT100` and 40-byte Compatible ID `XUSB10`, with the actual interface number inserted.
- Strictly bounded handling of the OS string and compatible-ID requests. Unsupported requests return false for delegation/STALL; this is intentionally not represented as a complete stock EP0 port or exhaustive XUSB handshake.
- The 20-byte input packet, using the mapping core's button/axis conversion.
- Persistent asynchronous IN buffer ownership, explicit completion, busy/rejected-send handling, and complete-packet OUT rumble/LED parsing.

The integration provides `start_in` and completion/reset/OUT events. The code never calls USB hardware itself and contains no stock firmware addresses. Callbacks must be serialized or externally synchronized. Before reset/disconnect releases the context buffer, the board port must stop/cancel any transfer that still owns it. OUT reception/rearming is also owned by the board port.

Host tests pass with C11, `-Wall -Wextra -Werror`. They cover descriptor self-lengths and endpoint substitution, correct compatible-ID interface number, request fields/truncation/output bounds, a golden 20-byte packet, in-flight buffer stability, wrong-endpoint completions, rejected starts, and malformed OUT packets. The RISC-V relocatable object also compiles with `-target riscv32-freestanding -mcpu=generic_rv32+m+a+c -mabi=ilp32 -ffreestanding -fno-builtin -Os`; its link dependencies are `gp_encode_xinput_state` and compiler-generated `memcpy`. Build evidence is in `stock-evidence/xusb-build.json`.

These tests establish a compiled protocol component. They do not establish native Windows enumeration, hardware endpoint operation, calibrated analog sampling on the board, or a working flashable image. The missing board/USB integration cannot honestly be replaced by wrapping this component in a stock container.
