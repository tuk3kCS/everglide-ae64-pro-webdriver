# AE64 Pro vendor-HID report protocol

This map was derived from the manufacturer JavaScript bundles captured in the two HAR files under `xsyd.top HAR files/`, checked against `ae64pro.txt`, and verified further with `captured_usb_packets.pcapng`. It describes the AE64 family; the HE30 uses a different protocol.

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
| `06` | Higher key | advanced-key reads and capture-verified SOCD pair writes; other writers deferred |
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

The packet contains both `normalPress` and `normalRelease`, but the captured AE64 application treats standard mode as a single **Trigger Travel** control: it reads and edits `normalPress` and leaves `normalRelease` untouched. In Rapid Trigger mode it hides `normalPress`, uses `rtFirstTouch` as the initial actuation distance, and exposes `rtPress` / `rtRelease` as the downstroke and upstroke movement sensitivities. The alternative UI keeps one Actuation distance control visible and maps it to the field used by the active mode. It also provides an explicitly experimental fixed-mode `normalRelease` control so that field can be tested without implying that the manufacturer UI normally edits it.

The original application writes only performance mode `0` (standard) or `1` (Rapid Trigger). No AE64 capability reply, UI branch, or captured write proves a mode equivalent to Wooting's Continuous Rapid Trigger. Mode `2` exists on the unrelated HE30 protocol, but is deliberately not sent to AE64 hardware without an AE64-specific capture.

Raw data uses `04 03 type row`, where `type` is `0` ADC, `1` route/travel, `2` calibration, or `3` key status. Ordinary tuning writes preserve axis/calibration metadata from a fresh hardware read.

The captured `getAxisListV3` response for board `0030000a`, VID `1ca6`, PID `300a` contains 82 switch profiles in five brand groups. In the original driver, choosing a switch copies `aixsDetail[0].axis_id`, `axis_range_max`, and `axis_coefficient` into `axisV2Id`, `axisRangeMax`, and `axisCoefficient` for every selected key, while preserving `calibrate` and every trigger/dead-zone value. The alternative selector follows that exact three-field update. Captured data lives in `assets/hall-effect-switches/supported-switches.json`; English names, aliases, colors, and local images are separate in `catalog-overrides.json` so the capture can be regenerated without losing editorial work.

Calibration is a device-wide live session rather than a normal staged performance write:

1. Send `02 06 00` to enter calibration.
2. For every firmware row `0…5`, repeatedly read ADC (`04 03 00 row`), Route (`04 03 01 row`), and Calibrate (`04 03 02 row`). The original driver requests all three matrices and places their values directly on the matching virtual keys.
3. The raw ADC value is shown at the lower-left of each key. Calibration status `0` is uncalibrated/red, `1` is calibrated/blue, and `2` is newly calibrated/green. The key fill is `route / axisRangeMax`; status `2` forces a full-height fill. A missing per-key range falls back to 4,000 raw units.
4. Send `02 06 01`, then commit save group `1`. The original driver normalizes in-memory status `2` to `1` after the session ends.

The original driver's startup warning is not timer- or firmware-version-based. After it reads the keyboard layout and each active key's `04 01` performance record, it opens the recommendation dialog if any non-empty key has performance byte 20 (`calibrate`) equal to `0`. Its matrix model has a special exception for alternate spacebar slots at firmware row 5, columns 3–8: empty/unused candidate slots do not force the warning when another occupied slot in that group is already calibrated. This project models only the 64 physical keys rather than the unused candidate cells, so the equivalent rule is simply “any readable physical key reports `calibrate = 0`.” The warning is shown once per onboard profile per page session; Confirm navigates to the Performance calibration control and does not start calibration without a second deliberate click.

The key-status matrix uses the same row/column addressing. The original driver's live travel test considers values `1…7` pressed and `0` idle.

## Lighting

Base configuration is read with `05 01 area 00` and written with `05 02 area 00 …`; reply/config bytes 4–9 are open mode, effect, brightness, speed, direction, and palette index. The manufacturer library contains 23 generic effect indexes, but this AE64's `02 08 00` reply is `02 08 00 02 00 14 06 0F 01 05 01 26`: area 0 reports **20** modes and area 1 reports **5** modes. The UI exposes `L1–L23` for keyboard experiments and `L1–L5` for Decorative1. `L21–L23` are marked unadvertised, show a contextual warning only while selected, and are accepted only if read-back verification returns the written value unchanged. Brightness and speed use the continuous range `0–100`. Direction is `0 = forward`, `1 = backward`; the captured UI does not define left/right values.

The main keyboard uses the manufacturer's double-lighting open enum as a bit mask: `0 = off`, `1 = lower/south-facing only`, `2 = upper/north-facing only`, and `3 = both`. The packet capture reads back value `3`, while global command `02 0A 00` reports double-lighting support as enabled. Decorative areas use the single-lighting values `0 = off`, `1 = on`.

Palette configuration uses subtype `01` with exactly eight `B,G,R,hue` records. The base record's palette index selects one of those stored slots; editing a slot and selecting a slot are separate operations. In the captured AE64 response, the eight RGB records are red, green, yellow, blue, magenta, cyan, white, and black, and all eight `hue` bytes are `00`.

The manufacturer's UI treats palette index `0` specially: it draws a rainbow swatch and does not offer an RGB editor for that entry. The stored red record is therefore a seed/placeholder, not the visible meaning of the selector. Rainbow is selected by base `paletteIndex = 0`; it is not encoded by a nonzero `hue` byte. Indexes `1…7` are the seven editable solid colors.

Fn does not own a separate palette or lighting configuration. Keycodes `F100…F103` switch to Main/Fn1/Fn2/Fn3. Keycode `0001` is Transparent: it resolves downward through the preceding layers until a non-transparent mapping is found. The original driver's mapping code reinforces this rule by automatically writing `0001` into every higher layer when an Fn-layer switch is assigned, allowing the same physical trigger to keep working after the layer changes.

While an Fn layer is held, the firmware lights only meaningful mappings that differ from the inherited mapping; transparent, empty, and unchanged positions remain dark. Highlighted positions use firmware-selected static colors, so different keys may share a color or use different colors. Those colors are not present in the key-map records and must not be invented by the web driver: they arrive in the ordinary area-0 `05 03` framebuffer. The alternative driver therefore polls type-3 key status only for rows containing `F101…F103` triggers (including remapped physical keys), resolves transparent mappings for labels, masks inherited positions, and preserves the exact per-key RGB delivered by the framebuffer.

The custom matrix and current LED framebuffer are read as `05 03 area packet` and custom overrides are written as `05 04 area packet …`. Each packet carries fifteen `B,G,R,flag` records. `flag = FF` enables a custom override; `00` leaves that LED following the base effect. During dynamic effects the RGB bytes still contain the instantaneous rendered LED color when the flag is `00`.

- Keyboard area 0 uses a `6 × 21` address space and nine packets. Visible AE64 keys occupy firmware rows 1–5; unused cells are preserved.
- Spacebar is one key-mapping/performance target but five RGB cells. The lighting UI treats the key's firmware row/column as the center LED and fans custom RGB to the two neighbouring cells on each side. This matches the original driver's special row-5 spacebar mirroring behavior without adding extra Space targets to key mapping, performance, or advanced-key editors.
- Decorative1 area 1 reports a `1 × 38` address space and uses three packets.
- The original driver repeatedly reads all packets. The Wireshark capture contains 214 complete keyboard framebuffer cycles with a median cycle-start interval of about **103 ms**, so live display is implemented at an approximately 10 Hz target without overlapping reads.

## Advanced keys and macros

Key combinations are not family `06` records. They are ordinary 16-bit layer mappings with a modifier mask in the high byte and one normal keyboard usage in the low byte. See `KEY_COMBINATIONS_AND_MEMORY.md` for timing, ambiguity, and capacity details.

`06 01 row col 00` returns the selected advanced record. The mode byte identifies `0` none, `1` DKS, `2` MPT, `3` MT, `4` TGL, `5` END, `6` SOCD, or `7` RS. `protocol.js` decodes these records for Feature Lab inspection. DKS, MPT, SOCD, and RS have capture-verified editors and writers; MT/TGL/END remain deferred.

Dynamic Key Stroke is a single mode-1 record on one physical host key:

```text
06 02 row col 01 key1-lo key1-hi key2-lo key2-hi key3-lo key3-hi key4-lo key4-hi trp1 trp2 trp3 trp4 db1-lo db1-hi db2-lo db2-hi
```

The original driver names the two physical thresholds `Min Travel` (`db1`) and `Max Travel` (`db2`). Its advanced-key help describes four-stage pressure sensing: key press, key bottom, key release, and key lift, with an example of one-key stop / one-key jump-throw in CS2. The captured decoder exposes four 16-bit keycodes, four one-byte lifecycle masks, and two 16-bit values divided by 1000 for millimetres. Unlike MPT, this is not “three ordered actuation depths”; it is a complete downstroke/return path.

Each `trp` byte is edited as seven visible cells, matching the original `P1–S–P2–S–R2–S–R1` UI: shallow press (`0x01`), downstroke span (`0x02`), deep press (`0x04`), bottom turnaround (`0x18`, representing both internal bits), deep release (`0x20`), upstroke span (`0x40`), and shallow release (`0x80`). Each cell is independently optional; adjacent selected cells show a connected held region. The original editor uses a fixed `0.1–3.3 mm` range for both thresholds. The physical host accepts the standard keyboard usages `4–115` and `224–231`. Outputs use the captured 49-key Basic palette and 50-key Extended palette; firmware `1.1.3.0` adds seven modifiers to Extended and a 12-action Mouse group. Empty, Transparent, media, lighting, firmware-control, macro, gamepad, and combination actions remain excluded. This driver also supports click-drag painting, normalizes the paired center bits exactly as the original UI does, and verifies all four keycodes, masks, and both thresholds after writing.

The existing HE30 DKS editor is a useful visual reference but not a safe protocol template for AE64. HE30 stores DKS in a fixed 1,024-byte per-profile DKS bank, maps a host key to bank-slot type `144`, and packs each output into mapping bytes plus a compact status bitfield. Its current alternative-driver codec translates Wooting-style DKS into HE30 stages with normalization/folding rules, so it cannot be assumed to round-trip every possible AE64 four-transition state. AE64 instead stores DKS directly in the family-`06` per-key record above.

Multi-Point Trigger is one mode-2 record on one physical host key:

```text
06 02 row col 02 key1-lo key1-hi key2-lo key2-hi key3-lo key3-hi depth1-lo depth1-hi depth2-lo depth2-hi depth3-lo depth3-hi
```

Depths are stored in thousandths of a millimetre. The firmware record always has three slots; this UI requires stages 1 and 2, permits stage 3 to remain keycode `0000`, and keeps all three depth fields strictly increasing. The captured original editor exposes only 49 basic and 57 extended keyboard usages for MPT—not Empty, Transparent, media, mouse, lighting, firmware-control, macro, gamepad, or combination values. It also requires the physical host to have a basic keyboard mapping.

Unlike the captured fixed `0.1–3.3 mm` editor, this driver derives the maximum from the selected host key's switch-selector `axis_range_max`, rounds it down to the nearest `0.1 mm`, and dynamically constrains each slider between its neighbours. The manufacturer tutorial describes three independent depths, a different key value at each stage, and a claimed stage-switching delay below 1 ms. Its example uses light, medium, and heavy presses for progressively stronger steering in Project CARS.

SOCD write behavior is captured and implemented. It always requires two `06 02` records followed by commit group `5`:

```text
06 02 rowA colA 06 rowB colB keyA-lo keyA-hi keyB-lo keyB-hi delay-lo delay-hi localModeA
06 02 rowB colB 06 rowA colA keyB-lo keyB-hi keyA-lo keyA-hi delay-lo delay-hi localModeB
```

The four UI modes and reciprocal mode-byte pairs are:

| UI mode | Overall value | `(localModeA, localModeB)` | Result while both are held |
| --- | ---: | --- | --- |
| Last Override | `0` | `(0, 0)` | most recent input wins |
| A Priority | `1` | `(1, 2)` | Key A wins |
| B Priority | `2` | `(2, 1)` | Key B wins |
| Neutral | `3` | `(3, 3)` | neither output is sent |

Rappy Snappy uses the corresponding mode-7 pair without a local priority byte:

```text
06 02 rowA colA 07 rowB colB keyA-lo keyA-hi keyB-lo keyB-hi delay-lo delay-hi
06 02 rowB colB 07 rowA colA keyB-lo keyB-hi keyA-lo keyA-hi delay-lo delay-hi
```

The captured manufacturer tutorial says that RS continuously compares the two selected switches, outputs the farther-pressed key, and permits both outputs when both switches are fully bottomed. The original example is Valorant counter-strafing.

The alternative driver refuses to overwrite a key when it already belongs to a different advanced assignment. After writing MPT it commits group `5`, reads the host record back, verifies all three outputs and depths, and restores Hall tuning that the firmware resets during assignment. SOCD and RS similarly verify both reciprocal records, their outputs and delay, then restore both keys' Hall tuning.

Macro metadata and data are read and written with family `07` operations `01`–`04`. The driver writes mode metadata, transfers every required event page, commits save group `6`, then reads the complete sequence back before accepting the change.

The original AE64 webpage gets capacity from `02 0E 00`; this board reports 16 macro slots and a capacity value of 960 firmware-defined units. Macro mode read/write uses:

```text
07 01 macroId
07 02 macroId valid actionCount-lo actionCount-hi repeatCount-lo repeatCount-hi mode
```

The original UI exposes six playback modes: four click-repeat variants where re-click is ignored, restarts, stops immediately, or stops after the current playback; plus two hold-repeat modes where release stops immediately or after the current playback. Click-repeat modes include a repeat count. Macro action data uses:

```text
07 03 macroId offset
07 04 macroId offset packedAction...
```

Each packed action is four bytes little-endian: bit 31 is direction (`1` pressed/down, `0` released/up), bits 16–30 are delay in milliseconds, and bits 0–15 are the 16-bit keycode. The original editor records keyboard operations, permits inserting/editing individual key records, lets the user choose direction up/down and time in milliseconds, supports drag-to-reorder, and validates each delay as `1…32768 ms`. Empty recordings are explicitly allowed in the UI as a draft state, but a saved macro needs complete key/time/direction data. A macro is bound to a physical key through ordinary key mapping using the macro keycode group; the sequence itself remains in family `07`.

The offset is a **page number**, not an event index. Each report carries 15 four-byte actions, so a macro with `actNum = 31` is transferred at offsets `0`, `1`, and `2`; only the first 31 decoded records are used. The captured original store reads `ceil(actNum / 15)` pages and writes the same 15-action slices. This driver follows that paging exactly and performs full multi-page read-back verification.

Playback modes `0…3` are finite click-repeat behaviors; the original UI clamps their repeat count to `1…9999`. Modes `4…5` repeat while the host key is held and store `repNum = 65535`. Although the original form accepts `32768 ms`, its packet encoder rejects any delay above `32767`; this driver uses the protocol-safe `1…32767 ms` range.

The original driver's **Clear Data** action keeps the macro slot valid, writes `actNum = 0`, and sends no data pages. It does not remove physical-layer mappings that reference the slot. The alternative driver preserves that distinction: clearing sequence data and removing an activation-key assignment are separate actions.

The reported `{ macroCount: 16, macroNumber: 960 }` fields remain firmware-defined units. The captured UI guards an edited slot with `macroCount + actNum <= macroNumber`, producing a 944-action per-edited-slot limit on this AE64. It does not sum every slot's action count, so the alternative driver mirrors that check without relabeling the 960 field as bytes or total events.

## Safety boundary

- Firmware family `08`, bootloader actions, and update-file handling do not exist in this implementation.
- Destructive factory reset remains disabled until device testing.
- Basic writable records are read before modification, committed with their matching save group, and important fields are read back for verification.
- Commands inferred only from generic manufacturer capabilities are displayed diagnostically, not sent to an AE64 unless its feature bitmap and packet shape are verified.
