# AE64 Pro processor and toolchain research

Investigated: October 28, 2026. Target: USB `1CA6:300A`, board `0030000A`, product `C048P010`, server microchip label `XS117`. This is static firmware and source inspection. No debugger connection, processor identification-register read, package inspection, or custom image execution was performed.

## Result

The five supplied application payloads contain **32-bit little-endian RISC-V code with compressed instructions**. The startup sequence and multiple peripheral addresses strongly identify an **HPMicro-compatible platform, most plausibly the HPM5300 family**. The exact underlying silicon part and package have not been established. `XS117` is a label in the manufacturer's firmware catalog; the current evidence does not prove that it is the public silicon ordering code.

A replacement firmware project is feasible as an engineering effort, but a working AE64 Pro board-support package has not been recovered. The public Sparklink SDK located in this search is a **browser-side WebHID JavaScript SDK**, not firmware source or a board HAL. Its examples import `@sparklinkplayjoy/sdk-keyboard-v2`, select a HID collection, and communicate with an already-running keyboard. See the [vendor's SDK v2 documentation](https://sparklinkplayjoy.github.io/keyboard-docs/keyboardv2/).

## Evidence ledger

These IDs identify this report's research observations; they are not REA engine Evidence IDs.

| ID | Observation / inference | Confidence and limit |
| --- | --- | --- |
| HW-01 | All five payloads start at file offset `0x1000` with RISC-V startup instructions; an embedded path contains `riscv-gnu-toolchain/newlib/newlib/libc/stdlib/rand.c`. | Direct byte and string observation. |
| HW-02 | Entry executes `AUIPC/ADDI` initialization of `gp`, `tp`, `sp`; clears `mstatus`; calls cache setup and section initialization; assigns `mtvec`; sets bit 1 of CSR `0x7D0`; calls reset handling. | Direct disassembly; correspondence to named HPM SDK routines is inferred from source and CSR behavior. |
| HW-03 | The startup structure matches the [HPM5300 GCC startup source](https://github.com/hpmicro/hpm_sdk/blob/main/soc/HPM5300/HPM5301/toolchains/gcc/start.S). | Strong platform-family evidence, not proof of one ordering code. |
| HW-04 | Multiple decoded LUI candidates build constants matching HPM GPIO, interrupt controller, USB, system controller, IO mux and PLL addresses. | Candidate offsets are saved in `hpm_mmio_candidate_matches.json`; a halfword-aligned scan can include data and requires control-flow confirmation. |
| HW-05 | The reconstructed application VMA is `0x80021000`; startup and independent string-address references agree. | Strong static reconstruction; not a direct flash read. |
| HW-06 | No public AE64 Pro firmware source, schematic, pin map, or vendor bare-metal SDK was obtained in the bounded searches performed. | An unresolved search result, not a claim that such material cannot exist. |

HW-04 compares against the [official HPM5361 peripheral definitions](https://github.com/hpmicro/hpm_sdk/blob/main/soc/HPM5300/HPM5361/hpm_soc_ip.h). For example, in v0.1.0.0 the payload has candidates for USB `0xF300C000` at `0xEA9C`, GPIO `0xF00D0000` at `0xDBB0`, PLIC `0xE4000000` at `0xDC1C`, SYSCTL `0xF4000000` at `0xE340`, IOC `0xF4040000` at `0xDB96`, and PLLCTLV2 `0xF40C0000` at `0xE074`. These constants recur in all five versions.

The [HPM5300 family overview](https://www.hpmicro.com/en/product-center/microcontroller/hpm5300) describes a RISC-V family with high-speed USB and up to 480 MHz operation. That is compatible with the target's observed software platform, but is not a substitute for reading the actual package marking or chip ID. Do not assume every HPM5300 variant has identical peripherals or clock limits.

## Latest-image memory reconstruction

For v0.1.0.0 only, using VMA `0x80021000` and the startup routine at payload `0x143B4`:

| Region / action | Reconstructed address or range | Status |
| --- | --- | --- |
| Application entry | `0x80021000` | Strong reconstruction from code references. |
| Global pointer | `0x00080B00` | Direct startup calculation. |
| Initial stack pointer | `0x00098C00` | Direct startup calculation. |
| Thread pointer | `0x0008D388` | Direct startup calculation. |
| First startup copy | source `0x8002104A`, destination `0x00000000`, length `0xED8` | Copy parameters observed; vector/ILM interpretation inferred. |
| Initialized data copy | source `0x8003CC00`, destination `0x00080300`, length `0x298` | Copy parameters observed; `.data` label inferred. |
| Zeroed data | destination `0x00080598` through `0x0008D388` | Observed bounds; `.bss` label inferred. |
| Additional ILM copy | source `0x8003CE98`, destination `0x00000ED8`, length `0x160` | Observed parameters; exact source section name unknown. |

These values describe this vendor build. They are not a complete reusable linker script. In particular, the payload's file offset, code VMA, physical flash offset, and bootloader transfer offset are different concepts. A container payload at `0x1000` does not mean that code should be linked at address `0x1000`.

The official [HPM5301 XIP linker file](https://github.com/hpmicro/hpm_sdk/blob/main/soc/HPM5300/HPM5301/toolchains/gcc/flash_xip.ld) puts ILM at zero and DLM at `0x80300`, consistent with this reconstruction. Its stock application origin differs from the vendor application. Using that linker file unchanged would therefore be inappropriate for this keyboard.

## Toolchain choices after exact hardware confirmation

The [official HPM SDK getting-started guide](https://hpm-sdk.readthedocs.io/en/latest/get_started.html) documents CMake, Python, Ninja and RISC-V GNU tools, with `HPM_SDK_BASE` and `GNURISCV_TOOLCHAIN_PATH` environment variables. The SDK also supports Andes and ZCC alternatives. Use a pinned SDK revision and a compatible compiler version. No toolchain was installed by this research subtask.

The [SDK CMake guide](https://hpm-sdk.readthedocs.io/en/v1.12.0/cmake_user_guide.html) exposes `RV_ARCH` and `RV_ABI`; its baseline is `rv32imac` / `ilp32`, with CSR and fence extensions handled by the build. The observed startup is compatible with that baseline. The complete instruction-extension requirements of the vendor image should be checked before selecting final flags. Do not select an ARM compiler or an arbitrary desktop RISC-V Linux target.

The official [CherryUSB keyboard example](https://github.com/hpmicro/hpm_sdk/tree/main/samples/cherryusb/device/hid/keyboard) is an appropriate USB bring-up reference once the HPM family and board wiring are confirmed. It is an evaluation-board sample, not an AE64 Pro firmware port. The [RT-Thread project](https://github.com/RT-Thread/rt-thread) can provide the RTOS foundation; preserving an RTOS is optional for a new design. No evidence presently establishes a ready-to-build QMK, ZMK, or VIA firmware target for this exact board.

## Required board work before a trustworthy custom build

1. Inspect and record the MCU package marking, crystal, flash device if separate, PCB revision, and test pads. Compare chip ID/debug registers with the exact manufacturer's manual. Avoid assigning an HPM part solely from `XS117` or a frequency advertisement.
2. Map the physical board: Hall sensor ADC channels and mux select pins, key positions, direct scan channels, RGB data pins and supply control, USB pins, reset circuitry and debug pads. A USB descriptor cannot reveal these connections.
3. Establish recovery that does not depend on the custom application working. Confirm physical ROM/bootloader entry and the necessary wiring on the actual board. A vendor WebHID “enter boot” command running inside the application is not enough if the application no longer enumerates.
4. Read and preserve a full flash backup where supported, configuration/calibration storage and option/security state. The five downloaded application containers are not full flash backups and do not establish bootloader contents.
5. Create a board definition and linker layout for the confirmed silicon. Preserve the bootloader and persistent-data regions. Recover startup section relocation, interrupt-vector handling and clock/USB setup rather than copying evaluation-board assumptions.
6. Build the first minimal image: startup, clocks, interrupt handling, USB keyboard enumeration, a version/device-info response, and an independently accessible recovery path. Prove these before adding Hall scanning and RGB.
7. Implement and validate Hall scanning/calibration, threshold and rapid-trigger logic, key mapping/layers, USB reporting, then optional macros/RGB/WebHID compatibility. Test raw ADC values and stable idle behavior before enabling output events.
8. Produce an ELF and map file, review section bounds and symbols, then extract the correct application binary. Package it using the container format and bootloader protocol documented separately in this bundle. Verify the package offline before any device write.

No exact debugger probe, pinout, recovery shortcut, chip security state, maximum custom application size, or physical flash address is asserted by this report. Those are concrete missing engineering inputs, not routine compiler options.

## Reproducing the MMIO candidate scan

Run `python probe_hpm_mmio.py <directory-containing-the-five-original-bin-files> --output matches.json` from any directory. It uses the bundled source snapshot for reference values, reads files only, and produces candidate offsets. It neither opens a HID device nor flashes anything. Offsets are relative to the application payload; add `0x1000` for offsets in the original container.

The source snapshots retain their original HPMicro BSD-3-Clause notices. `sources.json` records their URLs and SHA-256 hashes. Snapshot source revisions differ from the unrecovered vendor SDK revision; matching structure or addresses cannot establish source equivalence.
