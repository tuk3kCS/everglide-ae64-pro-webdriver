# Physical distance and existing-key-event adapter

This adapter adds physical-unit mappings and canonical keyboard pressed-state inputs to the original gamepad logic core. It does not change `ae64_gamepad.c`. It performs no USB I/O and does not access the keyboard.

## Files and units

- `include/ae64_gamepad_physical.h`: public configuration, frame, context and function declarations.
- `src/ae64_gamepad_physical.c`: physical-range validation/conversion, stock digital-event mapping, neutral/rearm handling and watchdog.
- `tests/test_gamepad_physical.c`: host tests, including custom physical ranges and 10,000 randomized frames.

Distances are unsigned integer **micrometers**, not arbitrary ADC counts or assumed key-travel percentages:

| User setting | start_um | end_um |
|---|---:|---:|
| 1–3 mm | 1000 | 3000 |
| 0.5–3.5 mm | 500 | 3500 |

Each frame supplies `travel_um[64]`, `max_travel_um[64]` and `valid_mask`. The board port must derive these from measured per-key physical calibration. The adapter cannot recover physical millimeters from an uncalibrated Hall reading by itself. `max_travel_um` must lie within 10..10000 for every bound key, and every analog binding must satisfy `0 <= start_um < end_um <= max_travel_um[key]`. An unreachable requested endpoint is rejected rather than silently changed.

The maximum stroke belongs to each key independently. Two different keys can therefore use the same 1–3 mm setting even when one has a calibrated 3.3 mm full stroke and another has 5.0 mm. The adapter converts each through that key's calibration before using the core. Both requested endpoints stay exact; intermediate outputs use integer fixed-point quantization.

Key indices are board-port logical indices 0..63. They are not automatically USB usages, row/column numbers, or scan codes. The actual sensor/matrix-to-logical-index mapping belongs in the board port.

## Digital buttons preserve the keyboard's actuation and RT behavior

`button[GP_BUTTON_COUNT]` and `dpad[4]` contain key indices or `GP_NONE`, with no separate press/release thresholds. Their outputs come exclusively from `frame.stock_pressed`, which must be the keyboard's existing canonical pressed/released/RT state. If a key's normal configuration emits a rapid-trigger release while it remains physically deep, the mapped gamepad button releases immediately. Conversely, an existing canonical press event is accepted even when this adapter's supplied physical depth is zero. No fake second actuation threshold is applied.

`stock_pressed_valid` must be true whenever a digital control is mapped. Unknown or stale canonical state is a fault. Opposing D-pad directions cancel in the output; their keys are still considered held during release-to-rearm checks.

One key may intentionally drive more than one control, including two buttons or a trigger plus a button. Duplicate mappings are allowed. Mapping one key to both signs of an axis follows the configured opposing-direction policy. A UI may choose to warn about conflicting mappings, but the adapter does not silently discard them.

## Analog settings

Physical sticks mirror the core's opposing-direction policy, curves, circular normalization and optional radial deadzone. Curve knots remain fractional input/output coordinates 0..10000 within the selected physical range. The additional radial deadzone is a normalized output fraction, not a physical millimeter value; the per-key `start_um` already provides a physical starting threshold. Core digital bindings stay `GP_NONE`, and stock digital state is applied only after the analog result is computed.

Both triggers remain independent, so LT and RT can be fully held simultaneously. Internal stick Y is positive upward. Use the existing core HID encoder for the documented HID Y inversion. The XInput-state encoder remains a byte-layout serializer, not a USB/XUSB backend.

## Configuration and lifecycle

1. Call `gp_physical_config_empty`, populate mappings/ranges/policies, and validate with `gp_physical_config_valid(config, measured_maximums)`.
2. Call `gp_physical_reset` on the context.
3. Supply coherent physical travel, per-key measured maxima, calibration validity and canonical stock pressed states in each `gp_physical_frame`.
4. Call `gp_physical_update`. A true return means an accepted update, including neutral/rearm frames. A false return means a fault and neutral output.
5. Independently call `gp_physical_watchdog` even when no frame arrives. A true result means a new neutral report must be sent by the board's output layer.

Every atomic settings change must increment `config.revision`. Mode changes and changes to the calibrated maximum of any bound key are also detected and reset the adapter. A fault, configuration/mode/calibration transition or watchdog expiry neutralizes the report and requires all analog mappings to be at or below their physical start thresholds **and** all mapped digital keys to be released before rearming. The release frame itself remains neutral; the next accepted frame can actuate.

For active modes, every bound key must have a valid calibration/frame bit, a reachable measured stroke, and physical travel no greater than that stroke. Calibration loss, missing travel, an out-of-range measurement, invalid configuration or unavailable digital pressed state returns false and resets output. GP_OFF always outputs neutral after configuration validation and does not require live travel or pressed-state data.

`gp_physical_bound_keys` returns all mapped keys after configuration validation. `gp_physical_keyboard_suppression` returns that mask in GP_CONTROLLER_ONLY and zero otherwise. The board port must apply the suppression mask to its keyboard output and send keyboard releases during mode transitions. GP_MIXED keeps the original keyboard path available while computing the gamepad state. Unbound keys are not suppressed.

## Minimal integration shape

```c
struct gp_physical_config config;
struct gp_physical_context context;
gp_physical_config_empty(&config);
config.mode = GP_CONTROLLER_ONLY;
config.trigger[0].key = selected_left_trigger_key;
config.trigger[0].start_um = 1000;
config.trigger[0].end_um = 3000;
config.trigger[1].key = selected_right_trigger_key;
config.trigger[1].start_um = 500;
config.trigger[1].end_um = 3500;
config.button[GP_A] = selected_A_key;
/* Validate against measured per-key maxima before activating the profile. */
if (!gp_physical_config_valid(&config, calibrated_maximum_um)) {
    /* Reject this profile in the settings layer. */
}
gp_physical_reset(&context);

/* Each coherent scanner/keyboard-state snapshot: */
struct gp_physical_frame frame = {
    .travel_um = calibrated_travel_um,
    .max_travel_um = calibrated_maximum_um,
    .valid_mask = calibrated_frame_valid_mask,
    .stock_pressed = existing_keyboard_pressed_mask,
    .stock_pressed_valid = existing_keyboard_state_valid,
    .now_ms = monotonic_milliseconds
};
struct gp_report report;
bool accepted = gp_physical_update(&context, &config, &frame, &report);
/* Report is neutral on faults too; the board output layer owns sending it. */
```

This is an integration shape, not a board driver. The names representing calibrated sensor snapshots and existing keyboard state must be implemented at the real scanner/key-state hooks.

## Verification

The host test run passed **140,737 always-evaluated checks**, including 10,000 deterministic randomized calibrated frames. Coverage includes exact 1–3 mm and 0.5–3.5 mm endpoints, different full strokes per key, simultaneous triggers, normal and RT-style digital press/release events, duplicate mappings, D-pad opposites, invalid ranges/calibration, configuration/max-stroke changes, release-to-rearm, watchdog timer wraparound, masks and curve monotonicity.

A separate strict RV32 freestanding compile also passed. It produces a relocatable object, not a keyboard firmware image. No startup, linker layout, scanner driver, USB backend, bootloader integration or hardware test is implied.

From the workspace root:

```powershell
& 'work/toolchains/zig-x86_64-windows-0.17.0/zig.exe' cc -std=c11 -Wall -Wextra -Werror -O2 -I outputs/AE64-Pro-research/gamepad/include outputs/AE64-Pro-research/gamepad/src/ae64_gamepad.c outputs/AE64-Pro-research/gamepad/src/ae64_gamepad_physical.c outputs/AE64-Pro-research/gamepad/tests/test_gamepad_physical.c -o work/gamepad-physical-tests.exe
& './work/gamepad-physical-tests.exe'
& 'work/toolchains/zig-x86_64-windows-0.17.0/zig.exe' cc -target riscv32-freestanding-none -mcpu=generic_rv32+m+a+c -mabi=ilp32 -ffreestanding -fno-builtin -std=c11 -Wall -Wextra -Werror -O2 -I outputs/AE64-Pro-research/gamepad/include -c outputs/AE64-Pro-research/gamepad/src/ae64_gamepad_physical.c -o work/ae64_gamepad_physical.rv32.o
```

These commands use the local toolchain downloaded for this investigation. A production build still needs the confirmed silicon/board SDK, matched target ABI/startup/linker layout, and the hardware integration steps in the broader guide.
