# Windows PC gamepad target: reference behavior and reproducible requirements

Research date: October 28, 2026. Target: AE64 Pro board `0030000A`. This document specifies desired behavior and records primary references. It does not establish that the keyboard currently implements these features or that working replacement firmware has been built.

The user-selected endpoint is **native Windows XInput**: two sticks, independent LT/RT, D-pad, ABXY, LB/RB, L3/R3 and Start/Back. Controller-only is the default; keyboard hybrid mode is optional. Generic HID/Steam Input is a distinct fallback.

## Documented reference behavior

**Wooting:** its [mode guide](https://help.wooting.io/article/100-how-to-change-your-keyboard-gamepad-mode) offers Xbox/XInput, classic HID/DirectInput and disabled modes, with OS differences and potential controller conflicts. Its [5.3.0 notes](https://wooting.io/wootility/changelogs/5.3.0) distinguish analog response curves from digital actuation and rapid-trigger settings. Its [5.0.0 notes](https://wooting.io/wootility/changelogs/5.0.0) document up to four profiles and typing/mapping-override behavior when gamepad is disabled.

**Keychron:** the [Launcher guide](https://www.keychron.com/blogs/news/how-to-set-gamepad-analog-and-gamepad-curves-on-launcher) describes per-key gamepad mappings, a gamepad profile mode, typing toggle, linear/smooth response modes and live joystick visualization. These are interaction references, not proof that the same calibration, firmware or transport works on AE64 Pro.

The official Keychron QMK source was inspected at branch `2025q3`, commit `2b493ff95f2665db719b1e95c91babb5036e72f3`:

| Source | Static observation |
| --- | --- |
| [game_controller_common.h](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/keyboards/keychron/common/analog_matrix/game_controller_common.h) | Independent XInput and typing mode flags; axis directions and button slots. |
| [game_controller_common.c](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/keyboards/keychron/common/analog_matrix/game_controller_common.c) | Four curve points, segment slopes, persistence and state clearing. |
| [action_xinput.c](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/keyboards/keychron/common/analog_matrix/action_xinput.c) | Xbox-style stick/trigger output and circular stick limiting. Independent triggers bypass the stick curve. |
| [action_joystick.c](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/keyboards/keychron/common/analog_matrix/action_joystick.c) | A separate generic joystick implementation. |
| [usb_descriptor_override.c](https://github.com/Keychron/qmk_firmware/blob/2b493ff95f2665db719b1e95c91babb5036e72f3/keyboards/keychron/common/analog_matrix/usb_descriptor_override.c) | USB interface/descriptor selection changes between modes. |

These files have GPL-2.0-or-later notices. Their implementation was not copied into the new standalone module. Static source presence does not establish exact behavior on every shipping Keychron model or release.

## Transport contract

[Microsoft's comparison](https://learn.microsoft.com/en-us/windows/win32/xinput/xinput-and-directinput) states that XInput cannot consume legacy DirectInput devices. A USB HID gamepad descriptor plus analog values is therefore not automatically XInput. Native operation needs the appropriate USB interface/control protocol and successful Windows driver binding, verified on the actual target.

The [XINPUT_GAMEPAD definition](https://learn.microsoft.com/en-us/windows/win32/api/xinput/ns-xinput-xinput_gamepad) describes host API state, **not the entire USB wire protocol**. Sending that structure through an arbitrary HID endpoint does not implement native XInput.

[Steam Input supports DirectInput gamepads](https://partner.steamgames.com/doc/features/steam_controller/device), providing a separately configured fallback for suitable games. This does not prove native enumeration with Steam closed or compatibility with every XInput-only game.

## Custom implementation requirements

This is a new engineering specification, not a reproduction of either vendor's algorithms.

| ID | Required behavior | Reproducible acceptance criterion |
| --- | --- | --- |
| GP-01 | LX, LY, RX, RY; independently configurable positive/negative key bindings. | Exercise every direction independently; unmapped coordinates remain centered. |
| GP-02 | Independent analog LT and RT. | Both triggers can reach maximum simultaneously without canceling. |
| GP-03 | D-pad, ABXY, LB/RB, L3/R3, Start/Back. | Each binding produces its own digital state; combinations retain held buttons. |
| GP-04 | Per-binding travel start/end, output limit, polarity and curve. | Start yields zero, end yields maximum, outliers clamp, invalid intervals are rejected. |
| GP-05 | Linear and adjustable monotone curves; separate trigger/stick settings. | A full input sweep stays bounded and monotone with exact endpoints. |
| GP-06 | Stick dead zones and circle/square gates. | Idle is exact zero; circle diagonals stay within unit magnitude. |
| GP-07 | Explicit opposite-direction policy. | Equal opposition gives the defined neutral result; release ordering is tested. |
| GP-08 | Controller assignments only by default, optional keyboard hybrid. | Bound keys are suppressed from the keyboard report in controller mode; unbound keys remain available. Hybrid duplication and mode-transition releases are explicit. |
| GP-09 | Mode/profile/fault transitions clear output. | Holding controls while switching modes yields a neutral next report, with no stuck state. |
| GP-10 | Atomic configuration and live output diagnostics. | Invalid/partial configuration never activates; travel, transformed values and final state are visible. |
| GP-11 | Native XInput, independent of Steam or a virtual-controller bridge. | With bridges closed, XInputGetState succeeds for the actual device and every control passes. |
| GP-12 | Keyboard-only/no-gamepad mode. | Controller enumeration can be removed, rather than leaving an idle controller confusing the game. Descriptor changes may require re-enumeration. |

Physical key choices belong in profiles, not fabricated pin mappings. WASD and a second four-key group can be example stick bindings; actual mappings must be configurable and tied to the measured board.

## Independent reference processing model

The following is an original reproducible design model. It does not claim vendor algorithm equivalence.

1. Obtain calibrated travel `t` in `[0,1]`. For a binding interval `[a,b]`, require `0 <= a < b <= 1`, then calculate `u = clamp((t-a)/(b-a),0,1)`.
2. Apply a bounded monotone response `v=f(u)`. Linear is `f(u)=u`; an optional smooth preset is `u*u*(3-2*u)`. Editable piecewise-linear points must have increasing inputs and nondecreasing outputs.
3. Scale to the binding's output maximum. Triggers are unipolar. One explicit neutral-opposition stick policy is `axis=clamp(v_positive-v_negative,-1,1)`.
4. Apply the selected axial/radial dead-zone and gate policy in a documented order. Avoid silently applying identical filtering twice. Circle limiting can divide both coordinates by `max(1,sqrt(x*x+y*y))`; square mode clips each independently.
5. Quantize at the backend boundary. XInput sticks are signed `[-32768,32767]`, zero-centered; positive X is right and positive Y is up. Triggers independently span `[0,255]`. Digital buttons use configurable press/release hysteresis.

Integer/fixed-point implementation is appropriate with overflow checks. Reject invalid intervals, ambiguous duplicate mappings and stale sample state. Report scheduling must be verified separately from Hall scan rate; an advertised keyboard polling rate does not establish gamepad report rate.

Analog axes consume continuous travel, separately from digital rapid-trigger state. Digital controller buttons can use a deliberate hysteresis/rapid-trigger policy. Per-trigger curves/ranges in this target specification extend beyond the inspected Keychron trigger path and should be presented as new functionality.

## Windows test boundary

Use [XInputGetState](https://learn.microsoft.com/en-us/windows/win32/api/xinput/nf-xinput-xinputgetstate) to record every control. Windows game-controller properties alone are insufficient for independent-trigger verification: Microsoft documents that the DirectInput view of XUSB combines them.

Test with Steam/bridges closed, then in games. Cover unplug/replug, reboot, suspend/resume, profile changes while held, a second controller, and simultaneous trigger/button combinations. Retain sensor, transformed-state and host traces to distinguish firmware errors from game behavior.

Some games reject simultaneous keyboard/mouse/controller use; [Wooting documents this](https://help.wooting.io/article/148-use-wooting-keyboard-with-rewasd-for-controlling-the-right-joystick-with-a-mouse). Suppressing keyboard events does not force acceptance of a separate mouse. Games may also apply their own dead zones, as described in [Microsoft's XInput guide](https://learn.microsoft.com/en-us/windows/win32/xinput/getting-started-with-xinput).

No console support, vendor-configurator compatibility, registry changes or third-party driver dependency is assumed. Native XInput on AE64 remains a hardware/USB integration milestone, requiring a functioning board port and real Windows enumeration tests.
