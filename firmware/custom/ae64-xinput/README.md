# AE64 Pro experimental native XInput and Fn RGB firmware

Current build: `../../AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.2.bin` (134,960 bytes), SHA256 `0a10429b593fec1b70648f2379ec0f9ac01f71238c4c179c1e7d77b18951469c`. Adds persistent static per-key Fn colors for all four onboard profiles × three Fn layers while retaining the gamepad extension. **This new build is not hardware-tested.** Read the [Fn RGB findings, storage and usage guide](../../../docs/firmware-research/fn-rgb/README.md).

`source/` now builds v0.2; its build evidence is in `v0.2/`. The original v0.1 source is retained in `history/v0.1-source.zip`. Top-level ELF/manifests below this folder remain historical v0.1 records.

The flashable image is [`../../AE64-Pro-XInput-EXPERIMENTAL-v0.1.bin`](../../AE64-Pro-XInput-EXPERIMENTAL-v0.1.bin), SHA-256 `fa97bcfef4cffe1fb8f2309ba537d2491dbc0fe7162eaec1db2c3d1ea220d69a` (131,464 bytes). It is an append-only extension of stock v0.1.0.0 for AE64 Pro board `0030000A`, retaining the stock application and initialization.

The user flashed this image through the factory driver. Read-only follow-up diagnostics confirmed custom AGP1 replies and native Windows Xbox 360 driver enumeration; XInputGetState returned a connected controller. Complete analog behavior, advanced factory modes, sustained timing, heap headroom and physical recovery remain open hardware tests.

## Configure and flash

Use the main web driver's **Gamepad mode → Hardware Solution** to edit assignments. It shares the driver's keyboard connection. Use **Firmware** to select this custom image or any bundled factory release. The standalone `/gamepad` page no longer exists.

The compiled defaults map Q/E to LT/RT and WASD to the left stick, with 0.5–3.5 mm windows. The measured board's configured switch range is 3.31 mm, so the original default window exceeds it. Click **Use keyboard travel limits** and review the resulting local draft before Apply; a smaller window such as 1–3 mm also works within that limit. No replacement firmware is required for this range correction.

Assignments are stored in RAM and reset on power loss. Export a JSON profile and reapply it after reconnecting. Digital buttons use the stock normal/RT latch; trigger and stick values use calibrated travel. The custom USB interface is XUSB `FF/5D/01`, with a Microsoft OS `XUSB10` compatible ID and separate 20-byte IN reports. The keyboard/configuration interfaces and VID/PID `1CA6:300A` are retained.

## Rebuild

From the repository root, using Python 3 and Zig 0.17.0:

```powershell
python firmware/custom/ae64-xinput/source/build.py --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --out build/ae64-xinput
python firmware/custom/ae64-xinput/source/verify.py --zig C:\path\to\zig.exe --stock firmware/XS117_C048P010_AE64Pro_App_v0.1.0.0_20260930a.bin --image-dir build/ae64-xinput --work build/verification
```

The source builder requires the exact stock SHA-256, links RV32IMAC code at `8003D000`, patches eight integration calls and descriptor pointers, reserves 4,100 bytes from the stock heap (4,096 usable), preserves original offsets/flash helpers, and updates container size/CRC. Compiled v0.2 state uses 3,792 bytes. New build manifests record every patch and symbol; verification records byte-preservation, container/ABI/link audits, host board/storage/protocol tests and real browser-client/C-firmware packet exchanges.

`source/` contains the integrated port and builders. `portable-reference/` preserves the original mapper/protocol/XUSB component tests. `component-test-results.json` and the build manifests describe the historical build environment; their original absolute command paths are retained as provenance. `check_xinput.py` is a read-only Windows controller-state diagnostic. The `.elf` is the extension with symbols, not a full keyboard flashing image.

After copying a newly built `.bin` into the repository's `firmware/` directory, run `node scripts/build-firmware-catalog.cjs`. It will appear in the web driver's firmware selector. Keep experimental builds explicitly labeled and retain their build metadata.
