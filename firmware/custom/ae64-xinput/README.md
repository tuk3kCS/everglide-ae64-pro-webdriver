# AE64 Pro experimental native XInput and Fn RGB firmware

Current build [XInput + Fn RGB v0.8.1](../../AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.8.1.bin), **143,696 bytes**, SHA-256 `168fc023054869df0f78ed36a7cf7bb873a4006cce30f03c4a71075c19f596bd`.

v0.8.1 saves the Xbox USB visibility choice and restores it before USB initialization, including after power loss and when another onboard profile is active. It builds on v0.8. See the [persistence report](../../../docs/firmware-research/gamepad/USB_PERSISTENCE_V081.md).

The image passed offline firmware and browser tests. Physical flashing and cold-boot verification remain pending. `source/` builds v0.8.1. Its ELF, manifests and verification evidence are in `v0.8.1/`. The previous binary and evidence remain in `v0.8/`, and `history/v0.8-source.zip` preserves the preceding source tree. The pinned stock base remains v0.1.0.0, SHA-256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`.

## Configure and flash

Use the main web driver's **Gamepad mode â†’ Hardware Solution** to edit assignments. It shares the driver's keyboard connection. Use **Firmware** to select this custom image or any bundled factory release. The standalone `/gamepad` page no longer exists.

v0.4 and newer start with no controller assignments unless a valid mapping was saved for the active onboard profile. Valid v0.4–v0.7 saved mappings remain readable in v0.8. Read and verify the active mapping after upgrading; configure/import and **Apply to keyboard** if needed. The mapping then survives power loss and native keymap/Fn saves. Export a backup before firmware changes or factory reset. In v0.8.1, the Xbox USB visibility switch saves its choice across power loss. After upgrading from v0.8, switch it off once to save the disabled preference. A keyboard without a saved preference starts enabled.

Digital controls follow the native normal/RT latch, and analog controls use calibrated travel. Saved custom windows are not silently changed when a switchâ€™s available range changes; invalid calibration/ranges remain neutral until corrected. A repeated USB configuration notification preserves existing transfer-buffer ownership.

## Rebuild

From the repository root, using Python 3 and Zig 0.17.0:

```powershell
python firmware/custom/ae64-xinput/source/build.py --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --out build/ae64-xinput
python firmware/custom/ae64-xinput/source/verify.py --wasi --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --image-dir build/ae64-xinput --work build/verification
```

The source builder requires the exact stock SHA-256, links RV32IMAC code at `8003D000`, patches fifteen pinned instruction/call sites and three descriptor callbacks, reserves 4,100 bytes from the stock heap (4,096 usable), preserves original offsets/flash helpers, and updates container size/CRC. The linker checks the total state against the same 4,096-byte reservation. New build manifests record every patch and symbol; verification records byte-preservation, container/ABI/link audits, host board/storage/protocol tests and real browser-client/C-firmware packet exchanges.

`source/` contains the integrated port and builders. `portable-reference/` preserves the original mapper/protocol/XUSB component tests. `component-test-results.json` and the build manifests describe the historical build environment; their original absolute command paths are retained as provenance. `check_xinput.py` is a read-only Windows controller-state diagnostic. The `.elf` is the extension with symbols, not a full keyboard flashing image.

After copying a newly built `.bin` into the repository's `firmware/` directory, run `node scripts/build-firmware-catalog.cjs`. It will appear in the web driver's firmware selector. Keep experimental builds explicitly labeled and retain their build metadata.

`--wasi` runs portable C tests as WebAssembly under Node instead of executing newly compiled native test programs. RV32 firmware compilation is unchanged. Omit it for the original native host-test path when execution is permitted. This run used WASI because Windows Application Control blocked new native executables; no policy or security setting was changed.
