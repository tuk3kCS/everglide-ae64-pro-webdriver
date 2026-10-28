# AGP1 gamepad configuration contract

This is a newly implemented custom-firmware protocol, not an existing factory command. Stock AE64 images reject these commands. The independent editor does not upload unless an INFO reply verifies this protocol, board `0030000A`, and the requested output capability. A capability flag must only be advertised by an integrated and initialized board backend. The offline C harness simulates flags for tests and is not a controller.

## Frames

WebHID report ID 0, exactly 64 payload bytes. Windows' leading report-ID byte is separate. Byte 0 is family `10` hex, byte 1 the command, byte 2 protocol version 1, byte 3 a request sequence, bytes 4–7 ASCII `AGP1`, byte 8 status (zero in requests), byte 9 data length 0–54, bytes 10–63 data/zero padding. Responses echo family/command/version/sequence/magic; nonzero status has no data.

Sequence identifies one request/reply. An independent nonzero 8-byte random **transaction token** owns a complete configuration transfer. It is a concurrency identifier, not user authentication. A transfer expires after 5,000 ms without an owner BEGIN/WRITE; the board must pass its current monotonic millisecond clock into `gp_vendor_handle`.

| Command | Request data | Reply data |
| --- | --- | --- |
| `20` INFO | empty | 20 bytes described below |
| `21` BEGIN | expected active revision LE32, intended CRC-32 LE32, total length LE16=208, token[8] | empty |
| `22` WRITE | token[8], offset LE16, 1–44 data bytes | empty |
| `23` COMMIT | token[8], intended CRC-32 LE32, expected active revision LE32 | new revision LE32, persistent flag byte |
| `24` ABORT | token[8] | empty |
| `25` READ | expected revision LE32, offset LE16, count byte 1–48 | revision LE32, offset LE16, requested bytes |

A second token cannot replace an active staging transaction, write into it, abort it or commit it. Repeated BEGIN with the same token and identical parameters is idempotent and preserves received bytes. A commit requires every byte, CRC agreement, unchanged revision, valid mappings and an available backend. Only then is the installation callback invoked. Its contract requires an atomic neutral/rearmed state installation and no partial changes on failure. Actual persistent storage remains the board port's responsibility.

The editor uses 40-byte write chunks, reads back the complete active blob after COMMIT, and compares it byte for byte. Missing acknowledgements after COMMIT produce an **unconfirmed** result, not a claim that nothing was applied. An expired owner cannot affect a later owner's transaction. Revision comparisons prevent lost updates between editors.

INFO data: bytes 0–3 board ID LE32; byte 4 capability bits (`1` HID, `2` native XInput, `4` persistence); byte 5 binding count=24; byte 6 version=1; byte 7 reserved=0; bytes 8–11 active revision; bytes 12–13 maximum accepted physical-travel units=10000 micrometers; bytes 14–15 blob length=208; bytes 16–19 active-blob CRC-32. A global 10 mm format bound is not the physical stroke of every installed switch.

Statuses: 0 OK, 1 unsupported, 2 malformed, 3 conflict/busy/wrong owner, 4 invalid configuration, 5 incomplete transfer, 6 CRC mismatch, 7 backend unavailable, 8 install/storage failure.

## Configuration blob: 208 bytes

The format is serialized explicitly; never transmit the compiler's C struct layout.

| Offset | Meaning |
| --- | --- |
| 0–3 | ASCII `AGC1` |
| 4 | format version 1 |
| 5 | mode: 0 off, 1 controller assignments only, 2 keyboard + controller |
| 6 | transport: 1 generic HID, 2 native XInput |
| 7, 8 | left/right stick flags: bit 0 circular; bits 1–2 opposition policy (0 difference, 1 neutral, 2 higher shaped output wins) |
| 9 | reserved zero |
| 10–11, 12–13 | left/right radial dead zones LE16, 0–9499 in 0–10000 units; square mode requires zero |
| 14–15 | binding count LE16=24 |
| 16–207 | 24 binding records of eight bytes each |

Binding record: byte 0 physical key index 0–63, or 255 unmapped; byte 1 curve 0 linear/1 smooth; bytes 2–3 start micrometers; bytes 4–5 full-output micrometers; bytes 6–7 declared switch travel micrometers. Require `0 <= start < end <= declared`, declared 10–10000. The board additionally checks the interval against independently obtained per-key calibrated stroke; browser metadata cannot override calibration. Digital controls ignore analog geometry for output and consume canonical keyboard/RT pressed states, while the records retain valid geometry for a stable shared format.

Record order: LT, RT, LX−, LX+, LY−, LY+, RX−, RX+, RY−, RY+, A, B, X, Y, LB, RB, Back, Start, L3, R3, D-pad Up, Down, Left, Right. Positive Y is up. Physical indices match the independent driver's exact 64-key layout; firmware still needs a verified physical-index-to-matrix translation.

The wire profile currently permits one controller assignment per physical key. The reusable physical engine can support duplicates, but the UI and wire format validator intentionally enforce the simpler v1 policy. Profile names live in exported JSON/browser drafts and are not stored in this compact blob.

## Analog behavior

For travel `t`, start `a`, end `b`, calculate `clamp((t-a)/(b-a),0,1)`, then the chosen curve. Linear is proportional; smooth uses fixed points `(0,0),(3333,2592),(6667,7408),(10000,10000)` with integer piecewise interpolation. Per-key stroke normalization can introduce sub-step quantization relative to the browser preview. Endpoints remain clamped exactly.

LT/RT quantize independently to 0–255, including simultaneous full travel. XInput sticks use their standard signed 16-bit range for precision, while each assigned direction uses the same configurable travel window. Digital buttons use the stock pressed state, preserving actuation/RT semantics. Config, calibration, mode, fault and stale-frame transitions neutralize and require release before rearming.

Neither this configuration protocol nor a successful host-side transaction establishes that native XInput USB enumeration works. See PATCH_FEASIBILITY.md for the remaining integration boundaries.
