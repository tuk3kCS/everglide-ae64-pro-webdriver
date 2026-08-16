# AE64 Pro vendor-HID report protocol

Derived from the manufacturer WebHID bundle referenced in `webhid.har`, and checked against the AE64 Pro USB descriptor in `ae64pro.txt`.

## Transport

| Property | Value |
| --- | --- |
| WebHID filter | `VID 1CA6`, `PID 300A`, usage page `FFB0`, usage `0001` |
| USB interface | `MI_02` |
| Interrupt endpoints | OUT `0x04`, IN `0x83` |
| WebHID report ID | `0` |
| Report payload | 64 bytes, zero-padded |
| Integer encoding | unsigned little-endian |

Requests and replies are processed serially. The first bytes of a reply echo the command family and operation.

## Packet families

All byte positions below are zero-based and unused bytes are `00`.

| Function | Request bytes | Reply data |
| --- | --- | --- |
| Device information | `01 02` | type/subtype, board ID, firmware at bytes 8–11, serial at bytes 17–28 |
| Device feature bitmap | `01 03` | magnetic/connection/RGB feature bits |
| RT precision | `02 0C 00` | byte 3, in micrometres (`/1000` for mm) |
| Commit performance to flash | `02 02 02` | saves active performance parameters to non-volatile memory |
| Commit layout/keymap to flash | `02 02 04` | saves active key layout parameters to non-volatile memory |
| Read performance | `04 01 row col` | performance structure below |
| Write performance | `04 02 row col …` | acknowledgement reply |
| Read key code | `03 03 layer row col` | 16-bit HID keycode at bytes 5–6 |
| Write key code | `03 04 layer row col codeLo codeHi` | acknowledgement reply |

## Performance payload

For `04 02`, bytes after `row col` are:

| Field | Bytes | Unit |
| --- | --- | --- |
| mode | 4 | `0` normal, `1` Rapid Trigger |
| normal press / release | 5–8 | mm × 1000, `uint16 LE` |
| RT first touch | 9–10 | mm × 1000, `uint16 LE` |
| RT press / release | 11–14 | mm × 1000, `uint16 LE` |
| press / release dead stroke | 15–18 | mm × 1000, `uint16 LE` |
| axis / calibration | 19–20 | byte |
| axis v2 ID | 21–22 | `uint16 LE` |
| axis range max | 23–24 | `uint16 LE` |
| axis coefficient | 25–26 | `uint16 LE` |

The driver reads each key's performance record before writing. This ensures that axis, calibration, and other firmware-specific values are not overwritten by the UI. After every successful save, it sends the matching `SaveParam` command to commit the change to the keyboard's non-volatile memory; browser storage is retained only as a recovery backup.

## Layout coordinates

AE64's five firmware keymap rows are **1–5**, while the browser UI rows are 0–4. The driver therefore uses `protocolRow = visibleRow + 1`; columns are zero-based within the displayed row. This distinction is essential: sending the visual row index made a `Q` write target the number row instead. The manufacturer protocol also exposes layout-discovery requests (`03 05 row`) for devices whose physical matrix differs.

No firmware-update or bootloader command is included.
