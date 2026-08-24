# AE64 Pro vendor-HID report protocol

This map was derived from the manufacturer JavaScript bundles captured in the two HAR files under `xsyd.top HAR files/`, then checked against `ae64pro.txt`. It describes the AE64 family; the HE30 uses a different protocol.

## Transport and identity

| Property | Value |
| --- | --- |
| WebHID filter | VID `1CA6`, PID `300A`, usage page `FFB0`, usage `0001` |
| Captured board ID | `0030000A` |
| Captured firmware | `0.0.7.0` |
| USB interface | `MI_02` |
| Endpoints | OUT `0x04`, IN `0x83` |
| WebHID report ID | `0` |
| Report payload | 64 bytes, zero-padded |
| Multi-byte integers | unsigned little-endian unless noted |

The driver serializes requests: only one request awaits a reply at a time. Normal replies echo the command family and operation in bytes 0–1. Configuration writes are accepted only after device info reports board ID `0030000A`.

## Command families

| ID | Family | Used by this release |
| ---: | --- | --- |
| `01` | Device | protocol version, identity, feature bitmap |
| `02` | Global | commits, profiles, system settings, rate, calibration, axis, lighting areas, precision, sleep, macro capacity, shake |
| `03` | Layout and key | four layers, per-key mapping, layout metadata, defaults |
| `04` | Performance | per-key Hall settings and raw axis data |
| `05` | Lighting | base effect, palette, custom matrix |
| `06` | Higher key | advanced-key reads; writes deferred |
| `07` | Macro | mode/data reads; writes deferred |
| `08` | Firmware upgrade | **excluded** |
| `0A` | Custom command | manufacturer web-driver handshake |
| `0C`–`11` | Display/three-mode/voice/touch/gamepad/3D | generic manufacturer surfaces, exposed through feature diagnostics when reported |

## Device and global commands

| Function | Request bytes | Reply |
| --- | --- | --- |
| Protocol version | `01 01` | main/sub/hardware/software at bytes 2–5 |
| Device information | `01 02` | type/subtype, big-endian board ID at 4–7, firmware at 8–11, serial at 17–28 |
| Device feature bitmap | `01 03` | axis/connection/basic/extended bitmaps at 2–5 |
| Commit parameters | `02 02 group` | matching acknowledgement |
| List profiles | `02 03 00` | count at byte 3 |
| Active profile | `02 03 01` | index at byte 3 |
| Switch profile | `02 03 02 index` | active index at byte 3 |
| Read/write profile name | `02 03 03/04 index …` | UTF-8, at most 32 bytes |
| System mode list/read/write | `02 04 00/01/02 …` | enumerated byte values |
| Polling-rate list/read/write | `02 05 00/01/02 …` | enumerated byte values |
| Calibration start/stop | `02 06 00/01` | acknowledgement |
| Axis library | `02 07 00` | count plus 16-bit IDs |
| Lighting areas | `02 08 00` | area records |
| Default axis | `02 09 01` / `02 09 00 id` | selected ID |
| Double/special lighting | `02 0A 00`, `02 0B 00` | feature values |
| RT precision | `02 0C 00` | byte 3, divided by 1000 for millimetres |
| RGB sleep read/write | `02 0D 01` / `02 0D 00 lo hi` | minutes |
| Macro capacity | `02 0E 00` | count and 16-bit capacity |
| Shake optimization | `02 10 01` / `02 10 00 enabled` | boolean |

Commit groups are `0` all, `1` calibration, `2` performance, `3` lighting, `4` layout, `5` higher/advanced key, `6` macro, and `7` axis.

System mode is `0 = Windows`, `1 = macOS`. AE64 polling-rate values are reverse ordered: `5 = 250 Hz`, `4 = 500 Hz`, `3 = 1,000 Hz`, `2 = 2,000 Hz`, `1 = 4,000 Hz`, and `0 = 8,000 Hz`. The generic manufacturer enum also defines `6 = 125 Hz`, but that option is not exposed for AE64.

## Layout and key mapping

| Function | Request |
| --- | --- |
| Read/write complete row | `03 01/02 layer row …` |
| Read key | `03 03 layer row col` |
| Write key | `03 04 layer row col codeLo codeHi` |
| Layout style/geometry | `03 05 row` |
| Default layout row | `03 06 packedSystemLayer row` |

The visible UI has rows 0–4, but AE64 firmware addresses physical rows **1–5**. Columns are zero-based within each displayed row. Keycodes are 16-bit values; this is wider than the standard one-byte keyboard usage space and permits media, mouse, lighting, and firmware-internal functions.

## Performance

Read with `04 01 row col`; write with `04 02 row col …`.

| Field | Packet bytes | Unit |
| --- | --- | --- |
| Mode | 4 | `0` normal, `1` Rapid Trigger |
| Normal press/release | 5–8 | millimetres × 1000, uint16 LE |
| RT first touch | 9–10 | millimetres × 1000 |
| RT press/release | 11–14 | millimetres × 1000 |
| Top/bottom dead stroke | 15–18 | millimetres × 1000 |
| Axis/calibration | 19–20 | byte each |
| Axis v2 ID | 21–22 | uint16 LE |
| Axis range maximum | 23–24 | uint16 LE |
| Axis coefficient | 25–26 | uint16 LE |

Raw data uses `04 03 type row`, where `type` is `0` ADC, `1` route/travel, `2` calibration, or `3` key status. The basic UI edits only the decoded performance fields and preserves axis/calibration metadata from a fresh hardware read.

## Lighting

Base configuration is read with `05 01 area 00` and written with `05 02 area 00 …`; reply/config bytes 4–9 are open mode, effect, brightness, speed, direction, and palette index. For the main keyboard (`area 0`), the original UI presents effect indexes as zero-based `L1` through `L23` and limits the visible list to the `count` returned by `02 08 00`. Brightness and speed use the continuous range `0–100`. Direction is `0 = forward`, `1 = backward`; the captured UI does not define left/right values. Single-lighting power is `0 = off`, `1 = on`.

Palette configuration uses subtype `01` with exactly eight `B,G,R,hue` records. The base record's palette index selects one of those stored slots; editing a slot and selecting a slot are separate operations.

The custom matrix is read as `05 03 area packet` and written as `05 04 area packet …`. Each packet carries fifteen `B,G,R,flag` records, so the `6 × 21` address space requires nine packets. `flag = FF` enables a per-key custom override; `00` leaves that cell following the base effect/palette. Visible AE64 keys occupy firmware rows 1–5 and unused cells are preserved.

## Advanced keys and macros

`06 01 row col 00` returns the selected advanced record. The mode byte identifies `0` none, `1` DKS, `2` MPT, `3` MT, `4` TGL, `5` END, `6` SOCD, or `7` RS. `protocol.js` decodes these records for Feature Lab inspection. The manufacturer write family is known, but editors/writers are deferred until captured examples can be verified on physical hardware.

Macro metadata/data is read with family `07` operations `01` and `03`. Macro mode/data writers (`02` and `04`) are likewise deferred.

## Safety boundary

- Firmware family `08`, bootloader actions, and update-file handling do not exist in this implementation.
- Destructive factory reset remains disabled until device testing.
- Basic writable records are read before modification, committed with their matching save group, and important fields are read back for verification.
- Commands inferred only from generic manufacturer capabilities are displayed diagnostically, not sent to an AE64 unless its feature bitmap and packet shape are verified.
