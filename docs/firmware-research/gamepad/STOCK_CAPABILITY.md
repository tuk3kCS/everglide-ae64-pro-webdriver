# AE64 Pro: stock gamepad capability and integration boundaries

The five supplied AE64 Pro app images do **not implement the generic web driver's Handle/gamepad protocol**. This is established from their native dispatch tables, their device-feature response, and the descriptors registered by the latest app. The generic website contains gamepad controls for other supported devices; their presence in the website is not evidence of a hidden working controller mode on the AE64 Pro.

This investigation used static code and offline decoding only. No keyboard command, mode switch, flash write, or reboot was sent for this task. A custom gamepad firmware has not been validated on hardware.

## Evidence retained

[stock-evidence/stock-capability.json](stock-evidence/stock-capability.json) records original payload SHA-256 values, native table entries, feature fields and decoded top-level HID collections for all five versions. The directory also contains exact native instruction excerpts, the three recovered HID descriptor byte arrays per version, and shipped JavaScript snippets G01–G04 with their source URL, hash, and offsets.

`stock-evidence/reconstruct.py` repeats the capability checks from the existing research workspace. `stock-evidence/descriptor_refs.py` reconstructs the latest descriptor address references. They operate on local files only.

## Native protocol support

The web driver's command-family enum assigns decimal 16 (`0x10`) to Handle. Every AE64 Pro native dispatch table contains only **one slot** for this family: command 0, pointing to `c.jr ra`, an immediate-return stub. Thus read command `10 01` and setting command `10 02` fail the command-count bound check before any mode-setting handler can run.

| App version | Family-16 count | Slot-0 table pointer | Stub payload offset |
| --- | ---: | --- | --- |
| 0.0.5.0 | 1 | `0x8003C150` | `0xC1AE` |
| 0.0.6.0 | 1 | `0x8003C1E0` | `0xC18C` |
| 0.0.7.0 | 1 | `0x8003C360` | `0xC2B6` |
| 0.0.8.0 | 1 | `0x8003C838` | `0xC458` |
| 0.1.0.0 | 1 | `0x8003CA50` | `0xC65E` |

The central parser initializes the response header to `FF FF`, copies a recognized family into byte 0, and only copies the subcommand into byte 1 after the bounds check. Consequently its ordinary unsupported response for these family-16 commands is consistent with `10 FF` followed by the cleared response payload. This is a static path result, not a captured USB transaction.

The generic driver's parser does not itself validate that response prefix before extracting support bits. An unsupported, zero-filled payload therefore becomes false support flags rather than enabling a mode.

## Feature advertisement

All five native `01 03` handlers write response bytes 2–5 as:

```text
02 01 01 00
```

G02 decodes these as magnetic switches, USB connection, RGB lighting, and zero extended-feature bits. The `gamepad` extended-feature flag is bit `0x20` of response byte 5, which is clear. The latest feature handler is payload `0xC660`; its ordinary branch ends at `0xC678`.

Setting that feature bit in an image would change an advertisement only. It would not add a USB gamepad report, analog mapping logic, a sender, or functioning Handle commands.

## What the generic driver supports

G01 builds 64-byte, report-ID-0 requests, zero-padded after these prefixes:

| Operation | Prefix |
| --- | --- |
| Query controller modes | `10 01` |
| Enable mode 1 | `10 02 01` |
| Enable mode 2 | `10 02 02` |
| Disable controller mode | `10 02 00` |
| Enable compatibility | `10 02 01 01` |
| Disable compatibility | `10 02 01 00` |

The query decoder extracts these fields:

- Response byte 2: bit 0 `xboxSupported`, bit 1 `normalSupported`, bit 7 `handleEnabled`.
- Byte 3: selected mode.
- Bytes 4–7: alternate-mode VID/PID as two little-endian words.
- Bytes 8–11: normal-mode VID/PID.
- Byte 16: compatibility-mode boolean.

These are source field names and generic host encodings. They do not establish that AE64 Pro has an Xbox-compatible USB implementation. G03 stores the fields and G04 hides the Handle menu unless **both** support flags are true and protocol version is at least `1.1.5.0`.

That threshold compares the `01 01` **protocol version**, not the downloadable app-firmware version. The latest AE64 app's native protocol reply is `1.2.1.0`; its downloadable firmware version is `0.1.0.0`. Mixing these two version number schemes would produce the wrong conclusion about why the menu is hidden. In stock AE64 Pro, the Handle-family implementation and support flags are absent regardless of the generic menu's version gate.

## USB reports currently present

The recovered and registered descriptors contain:

| Descriptor | Top-level application collections |
| --- | --- |
| Boot keyboard | Generic Desktop / Keyboard (`01:06`) |
| Multi-report | Keyboard (`01:06`), Consumer Control (`0C:01`), System Control (`01:80`), Mouse (`01:02`) |
| Vendor configuration | Vendor page `FFB0`, usage 1 |

None of these descriptors declares Generic Desktop Game Pad (`01:05`) or Joystick (`01:04`). Report IDs 1–4 are used in the multi-report descriptor; ID 5 is unused there. The vendor collection supplies 64-byte input and output payloads and is separate from the keyboard/mouse reports.

This establishes the capability of these recovered registered descriptor sets. It is not a claim about an unavailable bootloader, unpublished firmware, or different keyboard models sharing the website.

## Useful integration points in v0.1.0.0

These are **candidate engineering hooks**, not a tested patch recipe. All offsets are relative to the app payload; add `0x1000` for original-container offsets, or `0x80021000` for linked virtual addresses. They are version-specific.

### 1. Reuse the calibrated travel data path

The native `04 03` handler starts at payload `0xC2D6`. The shipped driver uses subcommand 0 for ADC and subcommand 1 for travel/route queries. Request byte 3 selects a row, limited to 0–5. The handler emits 21 little-endian 16-bit values for that row.

For the latest build, its per-key runtime records use:

```text
record = 0x00082BB8 + row * 0x5E8 + column * 0x48
ADC query value    = uint16(record + 0x18) >> 4
travel query value = uint16(record + 0x1A)
```

The decoded row stride is exactly 21 records of 72 bytes. Travel is read without the ADC right shift. The physical key-to-row/column mapping and the units/range of the travel value still need confirmation from the layout/calibration path and controlled keypress measurements.

A custom analog-gamepad path can potentially consume this existing travel value after the stock Hall scan/calibration update, avoiding a speculative rewrite of sensor initialization. Four selected keys can be transformed into two centered axes, for example `X = right - left` and `Y = down - up`, after per-key normalization and dead-zone handling. That mapping is a proposed design, not an existing stock gamepad routine.

The `04 03` request handler is useful for exposing and validating this data. Polling it on every USB frame is not itself a native gamepad implementation; the eventual in-firmware sampling hook should be placed in or after its data producer, whose timing and concurrency contract still need tracing.

### 2. Extend the registered multi-report descriptor

Latest app USB initialization loads the multi-report descriptor at payload `0x19EA4`, linked address `0x8003AEA4`, length `0x9D` (157 bytes). It passes these values to a HID interface initializer with interface storage at RAM `0x000876A4`:

| Instruction | Role |
| --- | --- |
| `0xE9F4` | `lui a2, 0x8003B`, high part of descriptor pointer |
| `0xE9FC` | `addi a3, zero, 0x9D`, descriptor length |
| `0xEA00` | `addi a2, a2, -0x15C`, complete pointer |
| `0xEA0A` | Call HID initializer at payload `0xEBCE` |

Exact excerpts and address computations are in `latest-descriptor-registration-multi.txt` and `latest-descriptor-xrefs.json`.

The boot-keyboard and vendor interfaces are registered separately at nearby code. Preserving them is useful for ordinary keyboard operation and the existing configuration/update protocol. A proposed standards-based HID design is a new Game Pad collection in the multi-report descriptor, using an unused report ID such as 5, with a report layout agreed with the new sender.

The current descriptor is followed closely by another descriptor. There is no established inline free space for an appended collection. Relocating a longer descriptor and updating its pointer and length is a candidate approach; all referenced flash limits, alignment, startup-copy sections, and bootloader size checks must be established first. A descriptor edit alone cannot generate analog reports.

### 3. Add a matching report sender and scheduling path

The latest report scheduler at payload `0x53F4–0x55B2` processes stock keyboard, consumer/system/mouse dirty flags and queues existing report buffers. Its NKRO path explicitly compares and copies 17-byte buffers. These stock sizes cannot be reused blindly for a new controller report.

A new report ID requires its own correctly sized buffer, state-change/periodic scheduling policy, queue submission and endpoint transfer integration. Candidate existing queue/scheduler code provides a starting point for reconstruction; the exact queue API, interrupt/thread rules, transfer lifetime, and backpressure must be established before injecting calls. `latest-report-scheduler.txt` preserves the relevant code.

### 4. Add configuration semantics deliberately

If the generic driver's Handle controls are to be reused, family `0x10` needs real query/setting handlers and an expanded pointer table. The latest family table begins at payload `0x195BC`; its family-16 entry is at `0x1963C`. Increasing its count without installing real handlers is invalid. Responses must expose only supported modes, and mode changes must match the actual descriptors and reports.

Alternatively, a custom configuration UI can use a separately specified vendor command for analog mappings while preserving stock commands. This is a design decision; the generic driver's Xbox/normal mode names need not dictate the custom protocol.

### 5. Preserve updates and recovery

The existing `08 01` software boot-entry path performs staging/header-marker operations before requesting reset; it must not be replaced with an unverified direct jump. Startup-copied ILM routines and reserved SRAM regions also matter to flash operations. The earlier protocol/native-handler report contains those details.

If a custom USB implementation fails to enumerate, no browser command can invoke software boot entry. Physical recovery and the existing bootloader's custom-image acceptance remain separate requirements. The described hooks do not establish a hardware-tested recovery path.

## Practical result

There is no supported stock command sequence that turns these five AE64 Pro images into a controller. The evidence supports developing an additional native HID gamepad data/report path or first validating the analog mapping through a host-side bridge. A HID Game Pad collection and an Xbox/XInput-compatible device are different USB/host integration targets; the latter does not follow from adding a HID report or changing VID/PID.

The strongest stock foundations are the existing calibrated-travel path, the recovered HID registration site, the USB report scheduler, and the vendor update protocol. A working custom image still requires integration, offline checks, and physical validation beyond this capability audit.
