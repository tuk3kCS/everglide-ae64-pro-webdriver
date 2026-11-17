# Four-point analog curves in AE64 Pro v0.10

## Wootility renderer findings

The installed Wootility 5.4.2 renderer `index-AyD-fgiJ.js` was extracted from `resources/app.asar`. Its SHA-256, `adc15b26f48001092ae800cff2859126c34b538b3b8840fb06bde414a2282577`, matches the renderer entry in the ASAR integrity metadata. The static analysis record for the curve excerpts is `ev_6702a180a695691756b97f735de06a11fd8b54490fdaf14bda21358bae47a2d7`. The following positions are character offsets in the decoded renderer.

| Renderer reference | Observation |
| --- | --- |
| `_9` through `kI` at 644964 and preset picker `hoe` at 4236921 | The picker selects one of seven four-pair coordinate tables named Linear, Aggro, Slow, Smooth, Steep, Instant, and Turbo. Both axes range from 0 through 255. |
| `p3` at 4215797, `roe` at 4219654, and `ioe` at 4221894 | Each point can move on both axes. Its horizontal bounds follow the neighboring points, and its vertical bounds span the full controller output range. The chart joins points with straight lines and extends the last value to the right edge. Dragging updates local chart state, and releasing dispatches the points. |
| `EI` at 646875, `WZ` at 1400116, and `UZ` near 1395905 | `CHANGE_ANALOG_CURVE` replaces the active gamepad profile’s single `mainCurve`. The active, initialized device’s profile subscriber forwards changed profile settings and mappings independently. The curve serializer sends four points alongside separate joystick settings. |
| `Zie` at 4210427 and `Zoe` at 4260441 | Setup supports None, X360, and HID gamepad modes. The polling interval control is capability-gated, and the mode-change flow tracks device rediscovery. |
| `Gie` at 4214710 and remap components near 4241232 | The binding palette picks Xbox or HID symbols based on the mode, shows supported slot usage, and distinguishes the gamepad mapping from keyboard output options. Keys controlled by advanced assignments can be disabled in the editor. |
| Gamepad view near 4261800 and tester near 4254407 | The renderer separates setup and remapping, configuration, and controller testing. The tester polls the selected Gamepad API slot and updates on a changed controller timestamp. |

This establishes the installed application's editor and profile data flow. Wooting's on-device evaluation and USB behavior were outside this renderer investigation.

## AE64 implementation

The AE64 editor uses those seven preset coordinate tables and gives each of the two triggers and eight stick directions its own curve. The horizontal axis and travel field show physical depth in millimeters to three decimal places. The vertical axis and output field use the curve's integer 0–255 scale. v0.10 stores 256 possible horizontal positions per travel window, so a typed value snaps to the closest supported position. A 0.500–3.500 mm window has about 0.012 mm between positions. The display uses the existing curve format, flash allocation, RAM reservation, and scan code. Pointer moves update the preview, and release stages the edit through the shared Apply flow.

The firmware uses the existing cached physical evaluator. It outputs zero at or below the start of the travel window and before the first point, uses fixed-point linear interpolation between points, and holds the fourth point’s output for the remaining travel. Travel positions must increase strictly. Output values may rise, fall, or stay level. Digital buttons still use the native press and release state. Instant and Turbo have distinct anchor positions and both produce full output immediately after the configured start on the AE64.

The 208-byte gamepad payload now starts with `AGC2` and schema byte 2. It uses the existing `AGP1` message envelope. The capability reply sets bit 5 to advertise four-point support, and the driver checks that bit before gamepad profile reads or writes.

| Payload offsets | Content |
| --- | --- |
| 0–15 | Header, output mode, transport, stick options, binding count |
| 16–95 | Ten 8-byte analog records with key number and travel window |
| 96–175 | Ten curves with four one-byte X/Y pairs each |
| 176–189 | Fourteen digital key numbers |
| 190–207 | Reserved, zero |

Each 240-byte `GPR2` record occupies the previous gamepad trailer at profile offset `0x1c00`. It retains checksum verification and writes the validating header after the payload. The separate USB visibility preference, Fn colors, and Main RGB keep their previous addresses and formats. A profile without a valid `GPR2` record starts unassigned. Export v1 gamepad JSON with the earlier driver before upgrading. The v2 editor imports those exports and approximates their original Linear or Smooth shape using four points.

The firmware image is 145,440 bytes, 16 bytes larger than v0.9. Its linked static state is 3,920 bytes of the same 4,096-byte reservation. Offline checks cover malformed coordinates, signed interpolation, exact read-back, persistent profile isolation, simulated reboot and flash failure, and the firmware image layout. Physical flashing and Windows controller output remain unverified.
