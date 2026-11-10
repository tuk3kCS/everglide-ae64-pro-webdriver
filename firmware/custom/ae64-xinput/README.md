# AE64 Pro experimental native XInput and per-profile RGB firmware

Current build [XInput + per-profile RGB v0.9](../../AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.9.bin), **145,424 bytes**, SHA-256 `d007b422520a00b66fd0b2039c534bf894b1dfdf772362fa2ee14119110c751c`.

v0.9 saves a checksummed Main per-key RGB record in the existing keymap allocation for each onboard slot. Slots without a valid record inherit the old shared Main matrix. The driver displays **v0.9.0.0 custom based on v0.1.0.0** and checks the Main RGB capability before it writes. v0.8.1 introduced persistent Xbox USB visibility and restores it before USB initialization. See the [persistence report](../../../docs/firmware-research/gamepad/USB_PERSISTENCE_V081.md).

v0.9 passed offline firmware and browser tests. Physical flashing and boot still need validation. The maintainer reported no issues in their latest physical-keyboard tests of v0.8.1. See [validation](../../../docs/firmware-research/VALIDATION.md#physical-keyboard-testing). `source/` builds v0.9. Its ELF, manifests and verification evidence are in `v0.9/`. The pinned stock base remains v0.1.0.0, SHA-256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`.

The [v0.9 storage map](../../../docs/firmware-research/hardware/AE64-Pro-v0.9-storage-map.svg) shows the flash banks, the four profile records, and the custom SRAM reservation.

## Configure and flash

Use the main web driver's **Gamepad mode → Hardware Solution** to edit assignments. It shares the driver's keyboard connection. Use **Firmware** to select this custom image or any bundled factory release. The standalone `/gamepad` page no longer exists.

v0.4 and newer start with no controller assignments unless a valid mapping was saved for the active onboard profile. Valid v0.4–v0.7 saved mappings remain readable in v0.8. Read and verify the active mapping after upgrading; configure/import and **Apply to keyboard** if needed. The mapping then survives power loss and native keymap/Fn saves. Export a backup before firmware changes or factory reset. From v0.8.1 onward, the Xbox USB visibility switch saves its choice across power loss. After upgrading from v0.8, switch it off once to save the disabled preference. A keyboard without a saved preference starts enabled.

Digital controls follow the native normal/RT latch, and analog controls use calibrated travel. Saved custom windows are not silently changed when a switch’s available range changes; invalid calibration/ranges remain neutral until corrected. A repeated USB configuration notification preserves existing transfer-buffer ownership.

## Rebuild

From the repository root, using Python 3 and Zig 0.17.0:

```powershell
python firmware/custom/ae64-xinput/source/build.py --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --out build/ae64-xinput
python firmware/custom/ae64-xinput/source/verify.py --wasi --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --image-dir build/ae64-xinput --work build/verification
```

The source builder requires the exact stock SHA-256, links RV32IMAC code at `8003D000`, patches pinned instruction and dispatch sites, reserves 4,100 bytes from the stock heap (4,096 usable), preserves original offsets and flash helpers, and updates container size and CRC. The linker checks the total state against the same 4,096-byte reservation. The build manifest records every patch and symbol. Verification covers original byte preservation, the container, ABI, linking, board and storage behavior, and packet exchanges between the browser client and compiled firmware.

`source/` contains the integrated port and builders. `portable-reference/` preserves the original mapper/protocol/XUSB component tests. `component-test-results.json` and the build manifests describe the historical build environment; their original absolute command paths are retained as provenance. `check_xinput.py` is a read-only Windows controller-state diagnostic. The `.elf` is the extension with symbols, not a full keyboard flashing image.

After copying a newly built `.bin` into the repository's `firmware/` directory, run `node scripts/build-firmware-catalog.cjs`. It will appear in the web driver's firmware selector. Keep experimental builds explicitly labeled and retain their build metadata.

`--wasi` runs portable C tests as WebAssembly under Node instead of executing newly compiled native test programs. RV32 firmware compilation is unchanged. Omit it for the original native host-test path when execution is permitted. This run used WASI because Windows Application Control blocked new native executables; no policy or security setting was changed.
