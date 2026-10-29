# AE64 Pro experimental native XInput and Fn RGB firmware

Current build: [`../../AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.3.bin`](../../AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.3.bin), **136,192 bytes**, SHA-256 `c14109b2911a52fd4f8a12bf0a89d295bdf4b8c4ebb76d13083bc03f3c087b71`.

v0.3 retains the v0.2 mapper and persistent Fn colors, adding a guarded **Xbox controller device** switch. Disabled mode exposes only the three original HID interfaces; enabled mode adds Xbox/XInput. The web driver waits for a USB reconnect and same-keyboard state verification. This USB choice and gamepad mappings last until power loss; boot defaults remain enabled. The output-mode option **Gamepad off** continues to mute input independently of device visibility.

**Offline verified; not hardware-tested or flashed during this work.** Active Windows device removal, PHY timing and recovery still require physical validation. Windows can retain non-present device history. Full folder/source analysis, protocol, guards and validation are in the [v0.3 report](../../../docs/firmware-research/gamepad/USB_DEVICE_SWITCH_V03.md).

`source/` builds v0.3; retained ELF/manifests are in `v0.3/`. The v0.2 image and `v0.2/` evidence remain unchanged. Its pre-change source is archived with repository-relative paths in `history/v0.2-source.zip`. v0.1 source/components remain historical in `history/` and `portable-reference/`; top-level older ELF/manifests are also historical. They do not describe the current image.

The pinned base is untouched factory v0.1.0.0, SHA-256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`. The extension preserves stock initialization and original offsets. A prior v0.1 experiment had read-only Windows XInput enumeration evidence; that does not validate v0.3.

## Configure and flash

Use the main web driver's **Gamepad mode → Hardware Solution** to edit assignments. It shares the driver's keyboard connection. Use **Firmware** to select this custom image or any bundled factory release. The standalone `/gamepad` page no longer exists.

The compiled defaults map Q/E to LT/RT and WASD to the left stick, with 0.5–3.5 mm windows. The measured board's configured switch range is 3.31 mm, so the original default window exceeds it. Click **Use keyboard travel limits** and review the resulting local draft before Apply; a smaller window such as 1–3 mm also works within that limit. No replacement firmware is required for this range correction.

Assignments are stored in RAM and reset on power loss. Export a JSON profile and reapply it after reconnecting. Digital buttons use the stock normal/RT latch; trigger and stick values use calibrated travel. The custom USB interface is XUSB `FF/5D/01`, with a Microsoft OS `XUSB10` compatible ID and separate 20-byte IN reports. The keyboard/configuration interfaces and VID/PID `1CA6:300A` are retained.

## Rebuild

From the repository root, using Python 3 and Zig 0.17.0:

```powershell
python firmware/custom/ae64-xinput/source/build.py --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --out build/ae64-xinput
python firmware/custom/ae64-xinput/source/verify.py --wasi --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --image-dir build/ae64-xinput --work build/verification
```

The source builder requires the exact stock SHA-256, links RV32IMAC code at `8003D000`, patches eight integration calls and three descriptor callbacks, reserves 4,100 bytes from the stock heap (4,096 usable), preserves original offsets/flash helpers, and updates container size/CRC. The linker checks the total state against the same 4,096-byte reservation. New build manifests record every patch and symbol; verification records byte-preservation, container/ABI/link audits, host board/storage/protocol tests and real browser-client/C-firmware packet exchanges.

`source/` contains the integrated port and builders. `portable-reference/` preserves the original mapper/protocol/XUSB component tests. `component-test-results.json` and the build manifests describe the historical build environment; their original absolute command paths are retained as provenance. `check_xinput.py` is a read-only Windows controller-state diagnostic. The `.elf` is the extension with symbols, not a full keyboard flashing image.

After copying a newly built `.bin` into the repository's `firmware/` directory, run `node scripts/build-firmware-catalog.cjs`. It will appear in the web driver's firmware selector. Keep experimental builds explicitly labeled and retain their build metadata.

`--wasi` runs portable C tests as WebAssembly under Node instead of executing newly compiled native test programs. RV32 firmware compilation is unchanged. Omit it for the original native host-test path when execution is permitted. This run used WASI because Windows Application Control blocked new native executables; no policy or security setting was changed.
