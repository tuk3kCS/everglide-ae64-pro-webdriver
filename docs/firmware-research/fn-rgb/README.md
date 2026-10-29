# Fn RGB extension v0.2

This build adds configurable static Fn lighting to the existing experimental native Xbox/XInput firmware. The pinned base is factory v0.1.0.0, SHA256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`. Analysis, compilation and tests did not write to a keyboard. This new image has not been tested on hardware.

## What the factory firmware actually does

The action processor recognizes mapped Fn actions `F100..F103` anywhere in the matrix, rather than requiring a fixed physical Fn key. It maintains held layers and selects an active Fn layer. The RGB compositor then reads the raw action assigned in that layer and chooses these fixed colors:

| Raw action family | Factory Fn color |
| --- | --- |
| Transparent, value 1 | Off/black |
| Ordinary keyboard, including explicit disabled value 0 | Yellow |
| Families 1xxx–4xxx | Cyan |
| Fn F1xx | Blue |
| System F2xx | Magenta; current profile switch is white |
| Lighting F3xx | Green |
| F5xx | Orange |

This confirms the described behavior with two qualifications: explicit disabled action 0 also lights yellow, and unrecognized action families may retain their base color. The lighting renderer examines raw Fn assignments; normal key action resolution can inherit transparent mappings from lower layers.

The native Fn renderer is payload offset `1456A`, called by the compositor at `A594`. Held state is `8D2D0 & 20`, active layer `82B9D`, onboard profile `82BA8`. `82BA9` is the Windows/Mac bank. All offsets and extracted native instructions are in [the rendering report](fn-rgb/REPORT.md).

## New behavior

- Four onboard profiles each have independent Fn 1, Fn 2 and Fn 3 color maps. All physical keys can be colored, including keys without Fn actions. Black turns a key off.
- Each layer has an enable flag. Disabled or missing custom maps use the original factory action-group lighting.
- The wrapper calls the factory renderer first, then replaces its main frame while an enabled Fn layer is held. Release returns to the normal effect on the next frame. Existing calibration indicators retain priority because their native overlay runs later.
- Color words use the factory Fn intensity convention: full intensity, with the original LED channel scaling. The main effect brightness slider does not dim Fn colors, matching stock Fn behavior.
- The main effect, normal per-key settings and perimeter strip still use their original controls. The new editor is an additional **Lighting → Fn 1 / Fn 2 / Fn 3** tab.
- The driver probes a separate `FNR1` capability. Stock firmware and earlier gamepad-only firmware keep the original UI; a firmware version string alone cannot enable the editor.
- The normal live RGB read command returns an earlier effect buffer, before the Fn overlay. The shared keyboard preview therefore shows the selected Fn layer’s configured draft colors while editing. It does not change the native effect buffer to fake a live Fn preview.

## Storage fits

The host matrix is 6×21, with six unused columns in each row. The LED frame is 6×15. Keeping the full host shape avoids inventing physical-key indices and supports Space's five LEDs.

Each onboard profile uses 1,134 RGB bytes (three 378-byte maps), two enable/reserved bytes and a 16-byte versioned CRC header: **1,152 bytes**. Native keymaps occupy offsets `0000..16AB` in each 8 KB allocation. The extension occupies `1700..1B7F`, within the verified unused tail. Total across four profiles is **4,608 bytes** in their existing allocations.

Only the current profile is cached in RAM. Linked extension BSS is **3,792 bytes**, within the existing 4,096-byte reservation; no further reduction of the 12,284-byte remaining native heap is needed. The image is 134,960 bytes, within the existing inferred 256 KB application region. Runtime heap headroom remains a hardware test.

The native save erases and rewrites the selected keymap allocation. The extension wraps native save to append its cached colors after every keymap save, and wraps native load to restore them. A complete CRC-checked trailer is required before enabling colors. Read-back is required after programming. Only the active onboard profile can be written; select another onboard profile in the sidebar first. Temporarily changing the native index would overwrite that profile with the wrong keymap, so the firmware rejects it.

Saving inherits the factory erase/rewrite power-loss boundary; it is not a dual-bank transactional flash store. Full factory reset erases the trailers. Returning to factory firmware can erase them on a subsequent keymap save. Export colors before changing firmware. See [the storage report](fn-storage/FINDINGS.md) for exact addresses, save/load signatures and interrupt constraints.

## Use

1. Export existing keyboard settings and gamepad assignments.
2. In **Firmware**, select **Experimental XInput + Fn RGB v0.2**, review it and start the update on the intended keyboard. Selecting it alone does not flash anything.
3. Reconnect. In **Lighting → Fn 1 / Fn 2 / Fn 3**, select the active onboard profile in the sidebar, choose the Fn 1, Fn 2 or Fn 3 button and read its map. Drag on the shared keyboard preview to select keys; Ctrl/⌘ toggles selection.
4. Enable custom colors, select keys, choose colors and click **Apply Fn profile**. Apply writes and reads back the selected layer. The normal Auto apply setting does not apply Fn drafts.
5. Hold a key mapped to that Fn layer to check the physical LEDs; release it to check the main effect. Repeat for the three layers and four profiles. Unplug/reconnect to validate persistence.
6. Reapply an exported gamepad profile after reconnecting. Gamepad assignments remain session-only; Fn colors persist independently.

## Protocol and verification

The separate extension uses family `10`, commands `30..35`, version 1 and magic `FNR1`. Requests/replies are 64 bytes. Header: family, command, version, sequence, four magic bytes, status, payload length; data starts at byte 10. INFO reports exact board ID, dimensions, static/persistence capabilities and the selected map's enabled state, profile revision and CRC. BEGIN selects profile/layer and carries expected revision, RGB checksum and a random 8-byte token. WRITE carries token, offset and up to 44 RGB bytes. COMMIT requires all 378 bytes and a matching CRC/revision before native save. READ returns chunks guarded by revision. Staging expires after 5 seconds. ABORT cancels staging. Profiles share a revision across their three layers, so read again after editing another layer.

Offline validation includes 40,084 storage checks (including every single-bit corruption of a trailer), 1,865 protocol checks, 24,726 synthetic board checks, browser-client/C-firmware packet exchange, existing gamepad and range regressions, complete container/CRC/hook/trampoline audits, all seven catalog image streams and browser UI checks. These establish implementation consistency, not hardware LED behavior, bootloader acceptance or recovery.

The rebuilt image, manifest, ELF and verification record are under `firmware/custom/ae64-xinput/v0.2/` and `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.2.bin`. Rebuild with `source/build.py`, then run `source/verify.py`; commands are in the custom firmware README. Native evidence is pinned to this stock release and does not establish layouts in future vendor builds.

The Fn editor uses the sidebar’s active profile only. Its three layer buttons sit beside Keyboard, Per-key and Light strip. It reuses the single unified keyboard preview and rectangle selection; there is no second keyboard or profile dropdown inside the Fn editor. This UI revision does not change the firmware image or FNR1 protocol.
