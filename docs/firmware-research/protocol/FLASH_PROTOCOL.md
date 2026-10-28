# AE64 Pro container and flashing protocol

Status: reconstructed from the shipped web driver and all five downloaded images on October 28, 2026. No boot transition, erase, write, validation command, or reboot was sent to the keyboard during this investigation. Protocol behavior below is a static observation of the host implementation, except where explicitly marked as an offline test or inference.

## Evidence and limits

The exact source spans are retained under [evidence](evidence/index.json), with source URLs, SHA-256 hashes, character offsets, UTF-8 byte offsets, and snippet hashes. Evidence IDs P01–P12 below refer to that index. They supplement the earlier REA JavaScript evidence `ev_409f8e2643b0d6e5bf8c130d16b1af04ba44f5c1a0a943602f94f0baac63a636`; the later-loaded device-page chunk was separately inspected as text and is not claimed to be covered by that earlier graph.

The bootloader image is not included in these app-update files. Its physical flash mapping, erase policy, image authentication, accepted maximum length, power-failure behavior, and recovery entry mechanism remain unestablished. Successful offline packaging is not proof that a custom program will boot or that the bootloader will accept it.

## Observed container layout

Every original image has a 4096-byte prefix followed by its app payload. These five little-endian 32-bit words occur at the start:

| File offset | Width | All five images / interpretation |
| --- | ---: | --- |
| `0x00` | 4 | `0xBEAF5AA5` (on disk `A5 5A AF BE`), fixed signature |
| `0x04` | 4 | `0x0030000A`, matches the board ID reported by the keyboard |
| `0x08` | 4 | `0x00001000`; this equals the observed payload boundary |
| `0x0C` | 4 | Exact number of bytes following the 4096-byte prefix |
| `0x10` | 4 | Standard CRC-32 of those payload bytes, matching Python `zlib.crc32` |
| `0x14–0xFFF` | 4076 | All zero in all five originals |
| `0x1000…` | varies | Application payload |

The precise bootloader meaning of the `0x08` word is not recovered. Treating it as a container payload boundary works for all five files. It is **not evidence of a physical flash base or CPU link address**. CRC-32 is an integrity checksum; its presence does not establish whether the bootloader has additional authenticity checks elsewhere.

| Firmware | Container bytes | Payload bytes | Stored / computed CRC-32 | Flash packets |
| --- | ---: | ---: | --- | ---: |
| v0.0.5.0 | 116,464 | 112,368 | `872A56BD` | 2080 |
| v0.0.6.0 | 116,608 | 112,512 | `518247DE` | 2083 |
| v0.0.7.0 | 116,992 | 112,896 | `157EC1EA` | 2090 |
| v0.0.8.0 | 118,232 | 114,136 | `AE146E4D` | 2112 |
| v0.1.0.0 | 118,776 | 114,680 | `E7E8A423` | 2121 |

## Transport

P03 defines a zero-filled 64-byte payload builder. P05 sends it with `HIDDevice.sendReport(0, payload)`. The supplied USB descriptor identifies the AE64 Pro vendor collection as usage page `0xFFB0`, usage `0x0001`, VID `0x1CA6`, PID `0x300A`. The Windows API uses a 65-byte report buffer with a leading zero report-ID byte; that byte is not part of the 64-byte payload offsets shown below. WebHID takes the report ID as a separate argument.

P08 passes returned bytes through unchanged for usage pages 65456 (`0xFFB0`) and 65408 (`0xFF80`). Other supported device families can have a four-byte prefix removed; that path must not be copied blindly to this model.

P05 retries when no response is received, at most three attempts. The ordinary wait timeout is 1000 ms, while the initial AppToBoot call supplies 10,000 ms. Commands are serialized through P08. Unrelated input reports can be delivered through the same event mechanism; the examined receive queue does not demonstrate strong command/response identity validation. A replacement flasher should validate the expected response family, command, length, and status using independently confirmed bootloader behavior.

## Command encodings

P01 maps the firmware-upgrade family to decimal 8. P02 maps its subcommands to 1–4. P04 builds the requests below. Trailing payload bytes are zero.

| Command | 64-byte payload |
| --- | --- |
| App to bootloader | `08 01` followed by 62 zeros |
| Write chunk | `08 02` + 4-byte LE container offset + 2-byte LE chunk length + up to 56 bytes |
| Validate image | `08 03` followed by 62 zeros |
| Bootloader to application | `08 04` followed by 62 zeros |

Write-chunk detail:

| Payload offset | Length | Meaning |
| --- | ---: | --- |
| 0 | 1 | `08`, firmware-upgrade family |
| 1 | 1 | `02`, write-chunk command |
| 2 | 4 | Unsigned little-endian **file/container-relative** offset |
| 6 | 2 | Unsigned little-endian data length, at most 56 |
| 8 | 0–56 | Exact original file bytes at that offset |
| after data | remainder | Zero padding to 64 bytes |

The upgrade loop in P06 starts at offset zero and advances by 56. It streams **the entire downloaded `.bin`, including the 4096-byte prefix**. It does not strip the prefix, pad the file to an erase boundary, translate offsets to MCU physical addresses, or omit the final partial packet.

For example, the first request for v0.1.0.0 starts:

```text
08 02 00 00 00 00 38 00 A5 5A AF BE 0A 00 30 00
00 10 00 00 F8 BF 01 00 23 A4 E8 E7 ...
```

The omitted bytes are zeros from the container prefix. In a Windows 65-byte report buffer, prepend `00` before the displayed `08`.

## Observed host upgrade sequence

P06 implements this sequence:

1. Read device information through the normal DeviceInfo command. Its reported `runModeVersion` is read from response payload byte 16 (P12).
2. If that value is not `255`, send AppToBoot (`08 01`). The currently attached keyboard earlier reported `0` while running its app. The inspected source treats `255` as already in boot mode, but its later check only rejects a value of `0`; it does not enforce a single exact boot-mode value.
3. Wait the default 6000 ms. Device events in P07 reconnect a matching vendor collection. The actual boot-mode VID/PID and manual boot entry have not been observed here.
4. Enumerate devices again. Stop with a `noDevice` status if none is found. Read DeviceInfo and stop if its `runModeVersion` is `0`.
5. Iterate over the complete container in chunks of at most 56 bytes, sending `08 02` and waiting for each response.
6. Send `08 03`. The host considers validation successful only when returned payload byte 2 equals `1`.
7. On validation success, send `08 04`, wait the default 3000 ms, and enumerate again. Missing application enumeration produces an `APPNoDevice` status.
8. The UI reinitializes the device and prompts for calibration after a successful update. Its failure path attempts `bootToApp`, waits, then closes/reopens a matching device (P10). This is an attempted recovery action, not a proven recovery guarantee.

### Important ACK limitation

P06's `getFlash` checks `response[2] !== 4095`. P08 supplies a `Uint8Array`, whose element cannot exceed 255; that comparison cannot reject any byte-valued status. The main loop also awaits `getFlash` without branching on its return value. Consequently **the inspected host code does not establish a meaningful per-chunk success status**. Do not interpret a response byte of `0`, `1`, or `255` as confirmed success solely from this source, and do not replicate this comparison in a new flasher. The final image-validation result is the observed overall gate.

## Host file selection and validation

P09 checks only a case-insensitive `.bin` filename suffix and that FileReader yields a nonempty ArrayBuffer. P10 then requires a selected file and nonempty Uint8Array. P11 downloads the online image into the same byte-array path. In these traced paths there is no host-side header parse, board-ID comparison, CRC calculation, signature verification, version rollback restriction, or payload stripping.

These observations say what this host does; they do not establish what the bootloader enforces. The server's `mandatory_update` metadata is not an observed local cryptographic restriction. Renaming or correctly wrapping an arbitrary binary is not evidence that it is runnable or compatible.

## Offline tooling

`ae64_container.py` uses only the Python standard library. It has no HID, USB, serial, subprocess, or network interface and cannot flash a keyboard. It rejects overwrite of an existing output file. Its operations are:

```powershell
# From this protocol directory; choose the actual original filename.
python ae64_container.py inspect "..\..\AE64-Pro-firmware\XS117_C048P010_AE64Pro_App_v0.0.7.0_20260625a.bin"

# Save the app bytes without the observed prefix.
python ae64_container.py extract "original.bin" "build\original-payload.bin"

# Wrap a separately linked/compiled app payload using an original as header template.
# This updates only length and CRC; it does not make the program hardware-compatible.
python ae64_container.py pack "original.bin" "build\custom-payload.bin" "build\custom-container.bin"

# Generate an offline transfer plan. Nothing is transmitted.
python ae64_container.py plan "build\custom-container.bin" --output "build\transfer-plan.json"
```

`--include-packets` on `plan` includes every 64-byte write payload as hex. These addresses remain file offsets, never physical flash addresses. The packer neither edits an embedded application version nor supplies startup code, a linker script, USB descriptors, pin mappings, ADC configuration, or a bootloader; those belong to the custom-firmware project.

For a later manually supervised update with a validated image, the existing driver offers Local Update: choose the wrapped `.bin` and then Start Update. The source indicates the driver performs the above boot/write/validate/reboot sequence. That UI path has not been tested with a custom image, and using it is premature until CPU architecture, link/load address, startup and peripheral initialization, calibration preservation, and recovery are established. The production bootloader must be preserved.

## Offline verification performed

- All five originals pass magic, board, boundary, exact payload-length, and CRC-32 checks.
- Extracting and repacking each original payload reproduces its original container byte for byte.
- A corrupted payload and wrong board ID are rejected by the tool.
- Reassembling all generated chunk payloads reproduces each complete original file.
- The isolated P04 request builder was executed with only its numeric constants and array helpers, without loading the app or communicating with hardware. Python's generated packet stream matches that builder on **every write packet of all five images**. See [vendor-packet-reference.json](vendor-packet-reference.json) for packet counts and whole-stream SHA-256 values.

Run `python test_offline.py` to repeat the three grouped tests against the five original images. These results verify format and request generation, not hardware flashing or bootloader acceptance.
