# Xbox USB preference persistence in v0.8.1

The v0.8.1 image saves the Xbox controller device toggle across unplugging, PC power cycles and keyboard restarts. The choice applies across the four onboard profiles.

Image `firmware/AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.8.1.bin` is 143,696 bytes. Its SHA-256 is `168fc023054869df0f78ed36a7cf7bb873a4006cce30f03c4a71075c19f596bd`.

## Behavior

- Upgrade from v0.8, then switch **Xbox controller device** off once to save the disabled preference. Fresh installations without a valid preference start enabled.
- A toggle change saves and verifies the native keymap, Fn colors, gamepad mapping and USB preference before acknowledging the queued USB reconnect.
- Startup restores the preference before the USB driver initializes. Disabled boots expose the native keyboard and configuration interfaces with no Xbox interface.
- Switching onboard profiles keeps the current Xbox visibility. Each later keymap, mapping or Fn-color save carries the latest preference forward.
- A redundant toggle request performs no flash erase. An invalid active profile or failed flash readback returns an error and starts no USB transition.
- The driver's separate **Gamepad off** output mode continues to mute controller reports. The Xbox device toggle controls enumeration.

## Storage and compatibility

The existing native 8 KB profile allocation contains the native keymap through offset `0x16AB`, Fn trailer at `0x1700`, and 240-byte GPR1 mapping trailer at `0x1C00`. A separate 16-byte GPU1 preference record occupies `0x1D00..0x1D0F`. Compile-time assertions check the boundaries.

| Bytes | Contents |
| --- | --- |
| 0–3 | GPU1 magic |
| 4 | Record version 1 |
| 5 | Owning storage profile, 0–3 |
| 6 | Xbox enabled, 0 or 1 |
| 7 | Reserved zero |
| 8–11 | Little-endian preference sequence |
| 12–15 | CRC-32 of bytes 0–11 |

Boot examines all four records and takes the newest valid sequence using unsigned wrap-aware comparison. Records copied by later profile saves retain the same sequence. Preference integrity is independent of mapping integrity. Existing GPR1 and FNR1 formats remain readable, including records written by v0.8.

AGP1 advertises capability bit `0x10` for persistent USB visibility. The driver uses it to describe the connected firmware's behavior. The USB status and toggle packet formats retain version 1.

Saving uses the existing native erase/rewrite operation and mapped readback. Power loss during the erase/rewrite itself can invalidate that profile's saved data. The CRC rejects incomplete preference records. A verified completed save survives later power loss. Reverting to older firmware and saving native keymaps can erase the new record.

## Editor change

The Gamepad editor opens with no controller action selected, including after an automatic onboard-profile read. Choosing an assigned physical key opens that action. Choosing an unassigned key, removing its assignment or restoring the examples clears selection. Tuning stays hidden until an action is selected.

## Verification

Offline image verification covers container CRC, pinned native patch sites, ELF sections, heap bounds, input trampolines, untouched native RGB paths and full-image packet reconstruction. The existing board, input suppression, Fn, storage, scanner and timing suites pass.

The USB suite exercises disabled/enabled cold boots, profile changes, preference propagation, mapping/Fn preservation, redundant requests, storage failure, sequence wrap, corrupt records, ACK handling, endpoint ownership and descriptor changes. The storage suite flips every preference-record bit and tests interrupted programming and neighboring data preservation.

Physical flashing, real power-cycle behavior and real flash timing remain unverified for this new image. These tests use synthetic RAM, flash and USB state.

The prior source is retained in `firmware/custom/ae64-xinput/history/v0.8-source.zip`. Build and verification manifests for this release are in `firmware/custom/ae64-xinput/v0.8.1/`.
