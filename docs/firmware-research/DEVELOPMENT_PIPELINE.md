# AE64 Pro custom firmware: source to binary to keyboard

This is the engineering pipeline supported by the current evidence. It includes working offline container tools and a tested portable C module. **A complete, flash-ready custom keyboard firmware has not been produced.** The board definition, exact silicon, Hall wiring, persistent-storage layout, bootloader acceptance and independent recovery still require hardware investigation. The supplied HPM project intentionally stops before building an unimplemented board port.

The architecture is RV32 RISC-V with compressed instructions. Multiple startup and MMIO matches strongly support HPM5300-family compatibility. `XS117` remains the catalog label, not a proven public part number. See [hardware evidence](hardware/HARDWARE_AND_TOOLCHAIN.md) and [startup maps](hardware/STARTUP_MEMORY_MAPS.md).

```mermaid
flowchart LR
    A[Confirm board and recovery] --> B[Implement startup and board drivers]
    B --> C[Write and test key logic]
    C --> D[Compile ELF and review map]
    D --> E[Extract application payload]
    E --> F[Package header and CRC]
    F --> G[Validate offline]
    G --> H[Bootloader transfer and hardware tests]
```

## 1. Choose the first development route

For a small feature, an audited patch to a known vendor application preserves much of the existing board initialization, scan/calibration and USB implementation. It still requires exact function/data mapping and recovery, and a CRC-correct patch is not automatically safe. A diagnostic string edit is not equivalent to a functional custom firmware.

For substantial changes, write a new application using the confirmed chip's SDK and your own board port. That is the route described by the [HPM project scaffold](development/hpm-port-template/README.md). It offers greater control but requires reconstructing startup, peripherals and firmware behavior. No ready AE64 Pro QMK/ZMK target or vendor firmware source was established in this investigation.

## 2. Establish board identity and recovery

Record MCU package markings/ID, PCB revision, clock source, flash device and accessible reset/debug/boot pads. Determine the real Hall sensor and mux/ADC connections, RGB wiring and USB configuration. Document them in `development/hpm-port-template/boards/ae64_pro`.

Before a custom application write, prove a recovery method that does not depend on the application enumerating. The required probe, JTAG/debug pinout and physical boot-entry procedure have not been established here. Do not substitute a guessed key combination or an evaluation-board pin map.

Obtain a full flash/persistent-state backup where the hardware permits it. Preserve bootloader, configuration, calibration and any security/option state. The five downloaded update containers are application images; they are not full-chip backups.

## 3. Reproduce the stock format offline

Commands in this document run from the extracted `AE64-Pro-research` folder. They use relative paths for portability and operate on local files only.

```powershell
$stock = 'originals/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin'
python protocol/ae64_container.py inspect $stock
python protocol/test_offline.py originals
New-Item -ItemType Directory -Force build | Out-Null
python protocol/ae64_container.py extract $stock build/stock.payload.bin
python protocol/ae64_container.py pack $stock build/stock.payload.bin build/stock.roundtrip.bin
Get-FileHash -Algorithm SHA256 $stock, build/stock.roundtrip.bin
```

The last two hashes must match. The supplied tests validate all five originals, reject corruption/wrong board, and reconstruct every container from generated packets. Tools refuse to overwrite existing output files; choose a fresh build output or deliberately remove a previous build artifact before rerunning.

Observed header fields are little-endian words: magic at `0x00`, board ID at `0x04`, `0x1000` at `0x08`, payload length at `0x0C`, and CRC-32 at `0x10`. Payload starts at file `0x1000`. Preserve the original header template and update length/CRC. The `0x1000` field is not the CPU link address.

## 4. Pin the development environment

Use the exact confirmed MCU's [official HPM SDK/toolchain setup](https://hpm-sdk.readthedocs.io/en/latest/get_started.html). Record SDK commit, compiler archive/version/hash, CMake/Ninja versions and Python dependencies. For the complete board build use the SDK's supported bare-metal RISC-V toolchain, not an ARM compiler or a RISC-V Linux executable target.

The starting architecture/ABI in the scaffold is `rv32imac_zicsr_zifencei` / `ilp32`. This is a baseline, not a proof that every selected SDK component or vendor instruction extension is covered. Compile output must be inspected against the selected silicon.

An official SHA-256-verified portable Zig 0.17.0 compiler was used during this investigation to validate only the new portable C module. It was staged under the task's work directory; it was not installed globally or bundled in this archive. [Compiler provenance](toolchain-provenance.json) and [test results](development/hpm-port-template/HOST_TEST_RESULTS.md) record the details. It does not replace the complete HPM firmware toolchain/BSP validation.

## 5. Reconstruct the application linker and startup

The vendor application's XIP entry is reconstructed at `0x80021000`. In the latest build GP is `0x80B00`, SP `0x98C00`, and TP `0x8D388`. Startup copies vector/ILM bytes into address zero, copies flash-operation/helper code into ILM near `0xED8`, copies initialized data to `0x80300`, and zeroes BSS. Low payload file offsets therefore cannot all be treated as their execution addresses.

Write `port/ae64_pro.ld` and startup code for the confirmed part. Review both VMA and load-memory addresses, copied sections, vectors, stack/heap and persistent storage. Do not simply link code at `0x1000`, reuse a stock evaluation-board XIP origin, or prepend a full-chip ROM boot header to an application update.

The native boot-entry path copies a 256 KiB active region to another flash range and modifies the active region's header page before requesting reset. This supports an active/backup layout hypothesis, but it does not prove bootloader size limits or recovery behavior. See [native boot-entry trace](protocol/NATIVE_HANDLERS.md). Do not treat the apparent copy boundary as an independently verified maximum custom image size.

## 6. Implement a minimal board port

Implement `port/board_port.c` against `include/board_port.h` and create the SDK board definition. Bring up clocks, reset, interrupt vectors, USB and a version response before enabling key output or persistent writes. The [official CherryUSB keyboard sample](https://github.com/hpmicro/hpm_sdk/tree/main/samples/cherryusb/device/hid/keyboard) is a controller reference; its evaluation-board wiring is not the AE64 Pro's wiring.

For compatibility, the observed application exposes VID/PID `1CA6:300A` and a vendor collection on usage page `FFB0`, usage 1, using 64-byte input/output payloads. Standard keyboard reports and the vendor configuration protocol are separate interfaces. Retain the protocol paths you intend to use, or provide your own host tool and independent recovery.

The original `08 01` boot-entry command does more than ACK and reset: it stages a backup and writes a boot-selection marker. Reimplementing it as a direct jump/reset is not supported by the observed firmware. A new board port needs the actual platform/bootloader transition, or an alternative recovery/update mechanism verified on the hardware.

## 7. Implement key processing in stages

Map physical keys to Hall channels/mux positions and USB usages. First expose raw ADC diagnostics. Then establish per-key released/pressed calibration, valid ranges, sensor fault handling and normalized travel. Avoid interpreting uncalibrated or missing samples as key presses.

Add press/release hysteresis and complete key-release behavior. The included new `src/key_logic.c` demonstrates fixed-threshold hysteresis on normalized travel; it is not the recovered vendor rapid-trigger algorithm. Its host tests cover threshold boundaries, noisy input in the hysteresis band, independent keys, full travel sweeps, invalid configurations and saturation.

```powershell
# From development/hpm-port-template, using your actual compiler path:
python host-tests/run_host_tests.py --compiler C:\tools\zig\zig.exe --compiler-arg cc --build-dir build-host
```

Those tests passed, and the module was separately compiled to a verified ELF32 RISC-V relocatable object. No bootable image is implied by a standalone object build.

Only after calibrated fixed-threshold input works should you add rapid trigger, layers, SOCD, macros or RGB. A new rapid-trigger implementation needs explicit extrema tracking, movement thresholds, top/bottom dead zones, noise handling and release rules. Validate sequences and recorded travel traces before live key output. Keep calibration data separate from ordinary key mappings and version any on-flash configuration layout.

## 8. Build the USB reports you actually declare

Keep the descriptor and buffer sizes in agreement. The latest stock shared Report ID 1 has 109 ordinary-key bits, 11 padding bits and eight modifier bits: 16 data bytes, or 17 including ID. Its lock-LED output has three bits plus five padding bits. Older stock shared reports are one byte shorter. Separate boot-keyboard reports follow their own descriptor and do not share this layout automatically.

Test empty/all-released reports, modifiers, simultaneous keys, held keys during profile changes, USB suspend/resume, reconnect, idle/protocol requests and LED outputs. If retaining vendor WebHID, bound-check every request and use consistent family/command/status replies. The native maps in [NATIVE_HANDLERS.md](protocol/NATIVE_HANDLERS.md) and the shipped SDK docs provide the starting wire formats.

## 9. Compile source to ELF and map

After the real board definition, startup, linker and peripheral implementations are complete, configure the scaffold:

```powershell
# Run from development/hpm-port-template.
$env:HPM_SDK_BASE = 'C:\tools\hpm_sdk'
$env:GNURISCV_TOOLCHAIN_PATH = 'C:\tools\riscv-gnu'
cmake -S . -B build -G Ninja -DBOARD=ae64_pro -DBOARD_SEARCH_PATH="$PWD/boards" -DCUSTOM_GCC_LINKER_FILE="$PWD/port/ae64_pro.ld" -DAE64_BOARD_PORT_READY=ON -DCMAKE_BUILD_TYPE=release
cmake --build build
```

The `AE64_BOARD_PORT_READY` setting is an explicit engineering gate, not a substitute for missing code. The supplied template still fails if `board_port.c` or the audited linker file is absent. A full SDK board build was not run in this investigation; only the isolated key-processing module was compiled and tested.

Keep the resulting ELF, map and build log. Verify the entry, machine/ABI, section sizes and all LOAD/copy destinations. Check for overlaps with bootloader, backup and persistent regions. Set and enforce an image-size limit only after the real partition map is confirmed.

## 10. Convert ELF to a raw application payload

Use the installed compiler's actual tool prefix. For an HPM toolchain exposing the documented `riscv32-unknown-elf` tools:

```powershell
$toolBin = Join-Path $env:GNURISCV_TOOLCHAIN_PATH 'bin'
& (Join-Path $toolBin 'riscv32-unknown-elf-readelf.exe') -h -l -S build/ae64_custom.elf
& (Join-Path $toolBin 'riscv32-unknown-elf-objcopy.exe') -O binary build/ae64_custom.elf build/app.payload.bin
```

Select the actual output ELF explicitly if its directory/name differs. The payload must begin at the application's intended entry/load origin and include the sources of all startup copies. Unexpected huge gaps usually indicate an incorrect LMA/VMA layout or included boot-header section. Resolve these before packaging.

## 11. Wrap the payload and inspect it

From the bundle root, using the compiled payload's actual path:

```powershell
$stock = 'originals/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin'
$payload = 'development/hpm-port-template/build/app.payload.bin'
python protocol/ae64_container.py pack $stock $payload build/ae64-custom.container.bin
python protocol/ae64_container.py inspect build/ae64-custom.container.bin
python protocol/ae64_container.py plan build/ae64-custom.container.bin --output build/flash-plan.json
```

The packer preserves the 4 KiB template header and updates length/CRC. It cannot validate your pinout, timing, linker layout, image capacity or bootloader authentication. The transfer plan is offline and sends nothing. Review the ELF, map, payload and container together.

## 12. Flash through the existing local-update path after bring-up prerequisites are met

For a hardware-validated application container with working independent recovery:

1. Keep a known-good original container and full backup accessible. Record the current board/firmware information and export settings where the driver supports it.
2. Open [the vendor web driver](https://www.xsyd.top/v2-app), connect the correct vendor collection, and open Firmware Update.
3. Choose **Local Update** and select the wrapped custom `.bin` container. File selection only checks the extension/nonempty file in the inspected host code; it is not a compatibility check.
4. Start the update. The driver performs the application-to-boot transition if needed, waits for re-enumeration, streams the **entire container including its header**, asks the bootloader to validate, then returns to the application. Entry into boot mode itself can modify flash state through the native backup/marker path.
5. Let validation and re-enumeration finish. On failure, use the recovery procedure already established for this board. The web driver's attempt to return to the app is not guaranteed recovery.
6. Verify enumeration, the custom version response, no spurious keys, release behavior and recovery before enabling further features. Calibrate through the custom implementation's documented procedure; never assume vendor calibration structures are interchangeable.

The observed wire sequence is `08 01`, chunks `08 02 + LE32(file offset) + LE16(length) + <=56 data bytes`, `08 03` validation, then `08 04`. HID report ID is zero and payload size is 64 bytes. These offsets are file offsets, not MCU addresses. The host accepts final validation response byte 2 equal to 1. Actual bootloader implementations and acceptance restrictions are absent from the five application files.

Do not copy the vendor's per-chunk ACK comparison into a new flasher: it compares a byte to 4095 and cannot reject a byte-valued status. The supplied tools intentionally generate offline packet plans only. A replacement live flasher requires observed bootloader response semantics, identity checks and timeout/recovery tests.

## 13. Complete hardware validation before calling it usable firmware

Test startup across cold/warm boots, full key maps and chords, scan timing/noise, calibration drift, malformed HID requests, profile switches, held keys during USB reconnect, suspend/resume, persistent-setting migration and update/recovery behavior. Measure the intended performance targets; no latency or 8 kHz scan claim follows from successful compilation or a descriptor alone.

Maintain a versioned release package containing source revision, SDK/toolchain lock, ELF/map, payload/container hashes, configuration schema, board revision, known-good rollback image and measured test results.

## Delivered and unresolved

Delivered: all-five binary comparison, decoded descriptors, startup maps, selected native handler traces, host updater reconstruction, tested container/packet tooling, portable C module with passing host/RV32 checks, and a board-port scaffold.

Unresolved: exact chip/package, board pinout, ADC/mux/calibration formats, full scan/RT algorithms, full flash partition/security state, bootloader code/acceptance, physical recovery and a complete working board port. Those require additional hardware evidence. This guide does not claim that the custom firmware can be flashed safely today merely because the header and CRC can be reproduced.
