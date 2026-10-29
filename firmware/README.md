# AE64 Pro firmware library

Extracted on October 28, 2026 from https://www.xsyd.top/v2-app.

Device: AE64 Pro; USB VID:PID 1CA6:300A; board ID 0030000A; product C048P010; chip XS117.
At initial extraction, the keyboard ran v0.0.7.0 and only read-only queries were used. The user later flashed the separately named experimental XInput image; Windows controller enumeration and AGP1 responses were subsequently observed.

## Included firmware

| Version | Firmware date | File size (bytes) | Original filename |
| --- | --- | ---: | --- |
| v0.1.0.0 | 2026-09-30 | 118,776 | XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin |
| v0.0.8.0 | 2026-09-01 | 118,232 | XS117_C048P010_AE64Pro_App_v0.0.8.0_20260901a.bin |
| v0.0.7.0 | 2026-06-25 | 116,992 | XS117_C048P010_AE64Pro_App_v0.0.7.0_20260625a.bin |
| v0.0.6.0 | 2026-05-19 | 116,608 | XS117_C048P010_AE64Pro_App_v0.0.6.0_20260519a.bin |
| v0.0.5.0 | 2026-03-05 | 116,464 | XS117_C048P010_AE64Pro_App_v0.0.5.0_20260305a.bin |

The server selected v0.1.0.0 as latest. Firmware dates are taken from the server firmware_time field; upload timestamps are retained separately in manifest.json and server-response.json.

## Scope and verification

This archive contains all five entries returned in the driver firmware-history array for this exact board and USB ID on the retrieval date. The current-firmware and latest-firmware entries duplicate v0.1.0.0. Earlier releases not exposed by that history list, removed files, or unpublished versions cannot be established from this result.

The five factory .bin downloads are unchanged original files. Each has the same firmware header signature and board ID 0030000A, and its declared payload size matches the downloaded length. All five stored CRC-32 checksums match their firmware payloads. SHA256SUMS.txt provides independently computed hashes. The manifest records source download URLs, sizes, HTTP metadata, original catalog fields, and header checks.

Source catalog endpoint: https://api.sparklinkplayjoy.com/api/v1/getKeyboardFirmware?board_id=0030000a&vid=1ca6&pid=300a

The application requests that endpoint with board_id, vid, and pid. Its history selector uses the returned firmwares array. Files are downloaded through the same-origin /storage/ paths, matching the driver URL rewriting.

Included metadata: manifest.json, server-response.json, SHA256SUMS.txt.

## Integrated firmware selector

The newest experimental custom build is **XInput + Fn RGB v0.3**, retaining persistent Fn colors and adding a guarded Xbox USB device switch. The setting lasts until power loss and is verified by the driver after USB reconnect. The image is compiled and offline-verified; hardware behavior remains untested. See the [v0.3 report](../docs/firmware-research/gamepad/USB_DEVICE_SWITCH_V03.md). The v0.2 image and its evidence remain available. The [Fn RGB guide](../docs/firmware-research/fn-rgb/README.md) documents the retained color storage and rendering behavior.

The web driver's Firmware tab reads `catalog.json` and lets the user select any listed image, including older factory versions and the custom builds currently present under this directory. Custom source/build evidence and limitations are under `custom/ae64-xinput/`.

Add new `.bin` files anywhere under this directory and run `node scripts/build-firmware-catalog.cjs` from the repository root. The script verifies the AE64 board header and payload CRC, then records the file's size and SHA-256. Invalid images fail catalog generation. GitHub Pages regenerates the catalog and copies the actual binary files into the deployment. No directory-listing service or factory API is required at runtime.

The UI also supports choosing a local binary directly. It validates the header, board ID, exact payload length and CRC before enabling review. Catalog files additionally require the catalog's SHA-256 and file size. Selecting a file never starts an update; the user must confirm Start firmware update.

The updater follows the reconstructed `08 01`, `08 02`, `08 03`, `08 04` lifecycle. It sends the full 4096-byte header plus payload, using at most 56 bytes per write packet. A per-chunk response is treated as receipt, not an invented success status. Only the separate validation reply byte 2 equal to 1 permits restart. Transfer failures are not blindly retried and failed validation never triggers an automatic application restart.

Bootloader and application reconnection are automatic, with no fixed startup delays or normal mode-selection prompts. A replaced HID object is matched by its reported serial; an unrelated or ambiguous same-model keyboard is never chosen as a fallback. The reviewed image stays in memory during the handoff. If the new USB mode needs browser access, the progress panel offers Allow recovery keyboard / Allow restarted keyboard; selecting it continues the running update automatically. No refresh or firmware reselection is needed. Browser access cannot be granted silently. If automatic reconnection ultimately fails, the updater stops and offers Reconnect keyboard; this Firmware-panel reconnect retains the selected image for a freshly reviewed full transfer. Background configuration traffic is paused and an exclusive transport lease blocks other requests during flashing.

The normal connection flow accepts both application and recovery collections, then reads identity before any application handshake or settings request. Recovery mode opens Firmware and requires a fresh image choice. Recovery disconnects retain this state; an authorized replug is detected automatically when no other device session is active. The driver will not resume an interrupted partial image automatically: choose the firmware and explicitly start a complete new transfer.

The new integrated updater is covered by simulated lifecycle/failure tests, real-image CRC/hash/packet tests and deployment tests. It has not been exercised on physical hardware. Do not treat file checks as proof of bootloader acceptance, a working application or recovery. The 256 KiB supported size bound comes from the stock application's inferred active-region backup behavior.
