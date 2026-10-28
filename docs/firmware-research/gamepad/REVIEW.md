# Independent gamepad logic review

This review covers `include/ae64_gamepad.h` and `src/ae64_gamepad.c` as an original host-testable controller logic module. It does not establish a working keyboard firmware, USB device backend, ADC calibration, bootloader recovery, or hardware compatibility.

## Static findings

No blocking defect was found in the inspected mapping, arithmetic bounds, configuration checks, or neutral-state handling.

- Input is calibrated normalized travel 0..10000. Values above the range clamp; unbound keys return zero. The caller must provide a valid calibration bit for every bound key. A missing bit neutralizes and resets the context.
- Curves enforce strictly increasing input knots and nondecreasing bounded output knots. Threshold ordering prevents division by zero. Intermediate curve, radius and axis products fit the used 32-bit types at the enforced limits.
- Circular sticks normalize diagonals and apply a radial deadzone; square sticks reject a nonzero radial-deadzone configuration. Internal stick Y is positive upward. Generic HID serialization inverts Y; XInput-state serialization preserves it.
- Both triggers remain independent unsigned 0..255 outputs. Button and D-pad mappings have press/release hysteresis. Opposing D-pad directions cancel, and analog axes implement depth difference, neutral-on-both and deeper-wins policies.
- Mapping revision/mode changes, invalid frames, and watchdog expiry neutralize outputs and require release before rearming. Callers must increment revision for every configuration mutation and call the watchdog independently of frame arrival.
- HID report descriptor and serializer agree on Report ID 5 and a 14-byte report including its ID. The serializer masks unimplemented button bits and includes a null hat value for centered D-pad.
- `gp_encode_xinput_state` serializes the 12-byte `XINPUT_GAMEPAD` field layout only. It does not implement Xbox USB/XUSB, Windows XInput enumeration, console authentication, force feedback, or an XInput driver. The header explicitly avoids claiming otherwise.

## Integration qualifications

1. Default analog start threshold zero makes release-to-rearm conservative: every bound analog key must normalize to exact zero before rearming. A board port must produce stable rest-zero calibration or configure a suitable nonzero start threshold. This is not an ADC-noise filter.
2. `GP_DEEPER_WINS` compares shaped normalized outputs after each binding's range/curve. If opposing bindings have different transforms, it does not necessarily select the key with greater raw sensor depth. User-facing settings should describe this policy accurately.
3. Controller-only mode suppresses bound keyboard keys through `gp_keyboard_suppression`; unbound keys remain available. The board/USB integration must actually apply that mask and send required keyboard releases on transitions.
4. The module cannot verify stale data unless its integration timestamps frames honestly and calls `gp_watchdog`. Calibration validity and trustworthy timestamps are caller responsibilities.
5. Input-profile edits without revision increments bypass the intended mapping-change rearm. Configuration writes should be atomic and revisioned in the board/UI layer.

## Independent test source

`tests/test_gamepad_review.c` adds configuration validation, key-63 mask, release-to-arm, revision/mode transitions, invalid calibration masks, watchdog wraparound, hysteresis, opposing directions, diagonal/radial behavior, independent trigger ranges, nonlinear curve monotonicity, exact HID/XInput-state byte layouts, descriptor bit counts, and 20,000 deterministic randomized frames with range/state invariants.

Execution result: **120,591 checks passed**, including 20,000 deterministic randomized frames. Build used the local Zig 0.17.0 toolchain with `cc -std=c11 -Wall -Wextra -Werror -O2`, then ran the resulting host executable. The test's `CHECK` macro always evaluates its expression and aborts explicitly on failure; results do not depend on the toolchain's release-mode `assert` configuration. No implementation changes were required by this review.

Reproduction from the workspace root:

```powershell
& 'work/toolchains/zig-x86_64-windows-0.17.0/zig.exe' cc -std=c11 -Wall -Wextra -Werror -O2 -I outputs/AE64-Pro-research/gamepad/include outputs/AE64-Pro-research/gamepad/src/ae64_gamepad.c outputs/AE64-Pro-research/gamepad/tests/test_gamepad_review.c -o work/gamepad-review.exe
& './work/gamepad-review.exe'
```

These tests validate pure logic on the host. They do not exercise USB enumeration, XInput, Hall sensors, timing, or keyboard hardware.

## Requirements clarification: physical distance and stock key events

The user's requested ranges are physical distances, for example 1–3 mm and 0.5–3.5 mm. This reviewed core consumes normalized depth and thresholds; it needs an explicit physical-unit adapter before integration. That adapter must use measured per-key calibration to convert physical distance to normalized coordinates, validate that start < end and both are reachable within the measured stroke, and expose millimeters or micrometers honestly in configuration. A configured zero and gain alone cannot prove millimeter accuracy without a physical calibration reference. For a hypothetical calibrated 4.0 mm full stroke, 1–3 mm becomes normalized 2500–7500 and 0.5–3.5 mm becomes 1250–8750; this example does not assert the AE64's actual stroke.

For digital gamepad buttons, a stock-firmware integration should be able to consume the keyboard's existing canonical pressed/released/RT events. The standalone module currently offers an independent travel-threshold/hysteresis digital path. It must not silently force a second unrelated threshold when the intended behavior is "activate when this keyboard key is pressed" according to the user's existing RT/key configuration. The preferred integration path is a canonical key-state input or equivalent adapter; threshold-based digital behavior should be an explicit fallback or user-selected policy.

These are integration requirements, not claims that the current pure logic module already implements physical calibration or stock event reuse.
