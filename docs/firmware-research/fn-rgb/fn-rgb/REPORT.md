# Native Fn RGB trace (latest factory v0.1.0.0 / 20260930a)

All offsets below are payload offsets, CPU base 0x80021000. Static instruction/data evidence only: these findings do not assert live hardware validation. Extracted instructions and byte identity are saved beside this report.

## Verified behavior

* Native scan/event code loops over 6 rows by 21 key records. The action processor recognizes the action family 0xF100..0xF103; it does not check for a special physical Fn position. Press path at 0x591A..0x5940 derives the Fn layer from the action low byte, writes it to 0x82B9D, sets held-layer byte `0x82B9E + layer`, and sets flag 0x20 at 0x8D2D0. The release path 0x5A56..0x5ABC clears held entries, resolves another held layer if applicable, and clears flag0x20. Fn can therefore be mapped to another physical key.
* Global layout state: 0x82B9C is previous frame Fn layer, 0x82B9D current Fn layer. 0x82BA8 is current configuration/profile index 0..3. **0x82BA9 is OS bank 0..1 (Windows/macOS), not profile.** The BB14 settings handler reads the latter and constrains writes to 0/1. The renderer compares action `0xF205 + [0x82BA8]` to highlight the current configuration switch.
* The native Fn/status overlay renderer is 0x1456A (CPU0x8003556A). It tests held flag0x20 at entry. While held it loads each key action from the active profile's loaded RAM record:
  `0x84F28 + row*0x3C6 + col*0x2E + 2*(OS_bank*4 + Fn_layer)`.
  Unlike the ordinary action resolver 0x5B2C, which resolves transparent1 downward through lower layers, the lighting renderer examines the raw Fn-layer action.
* Raw transparent action1 renders black. Supported nontransparent action families render fixed group colors. This validates the main behavior the user described, with a precision caveat: explicit action0 is grouped with ordinary keyboard actions and receives yellow. Unsupported action families can retain the previous base color. It is not strictly an `action != 0` illumination test.
* Native group color words before output scaling (ARGB-style high byte controls per-color intensity): transparent1 `FF000000` black; ordinary 0x0xxx `FFFFFF00` yellow; 0x1xxx/0x2xxx/0x3xxx/0x4xxx `FF00FFFF` cyan; Fn0xF1xx `FF0000FF` blue; system0xF2xx `FFFF00FF` magenta, selected config-switch action `FFFFFFFF` white; lighting0xF3xx `FF00FF00` green; action0xF5xx `FFFF7F00` orange. Exact labels are host source semantics; grouping/color branches are native evidence.

## Render hook and memory

The frame function at0xA536 merges main/custom effects, calls this native Fn/status renderer at0xA594 (`ef90707d`, JAL +0x9FD6), then performs calibration overlay and output conversion. A version-pinned wrapper can replace exactly this call, call native0x1456A first, and then overwrite the main framebuffer for enabled custom Fn1..3. Checks should require valid profile0..3, Fnlayer1..3, held flag0x20, and enabled custom profile; otherwise return without touching the native result. The original caller ignores return value.

The constant native main LED descriptor at CPU0x8003C020 contains width15 and height6. Its fields are:

* +0 dimensions: bytes0F06.
* +4 main composed framebuffer0x8D084, 90×4=360bytes.
* +8 user override RGB array0x8CF1C.
* +0C transient/status override array0x8CDB4.
* +10 effect/live-read array0x8CC4C.
* +14 encoded output buffer0x8C388.

Native cell writer0xA3B8 takes `(descriptor, col, row, color_word)` and bounds-checks `col<15,row<6`, writing `[descriptor+4] + 4*(row*15+col)`. It is safe to fill the90 main framebuffer entries directly inside the wrapper (all rows, including blank cells) using this same bounds. Any physical-key/color mapping must use actual firmware physical coordinates from the layout data, not visual sequential columns; space's multiple LED cells need explicit replication. The six extra host-wire columns per row have no native LEDs.

The converter at0xA456 reads R/G/B components, brightness/scale state, and emits the serial LED bitstream. Reusing this pipeline preserves stock output conversion. Native calibration overlays run after this proposed hook, so they can still supersede custom Fn colors during calibration.

Important preview caveat: native host command05:03 reads descriptor+10 (0x8CC4C) using21-column wire rows and synthesizes zero for columns15..20. Native Fn overlay is written to descriptor+4 after the normal buffer copy. Thus current host live RGB reads are pre-Fn-overlay, and cannot by themselves validate physical Fn colors. Do not write custom Fn colors into+10 merely to make the live preview match: that would contaminate the effect state and affect release behavior. The custom host UI should render the configured Fn static colors itself or use an explicitly defined overlay-read command.

## Remaining limits

No runtime keyboard write, Fn hold, or flash was performed for this trace. Physical LED channel order, calibration overlay precedence and key-to-cell mappings are established statically but still need on-keyboard validation. There is no proof here about available persistence storage; that is a separate trace.

## Hook-specific tests

A host stub should establish that stock renderer runs once before custom writes; enabled+held Fn1/2/3 selects the right profile/layer matrix; each of4×3 profiles remains isolated; Fn0/noFn, disabled layer, invalid profile/layer leave the stock frame intact; RGB00/FF endpoints pack as AARRGGBB correctly; column14 is written, host-wire columns15..20 are ignored, row5/col14 stays within360-byte frame; releasing Fn lets the stock frame restore on its next compositor pass; callbacks never modify effect/strip buffers; calibration overlays retain precedence because their native code follows the hook. Snapshot held/profile/layer once per frame to avoid mixing profile state midway through a matrix copy.

Brightness precision: A456 uses a nonzero alpha byte as per-color intensity (alpha+1)/256. An alpha0 color falls back to the normal effect's brightness table via state+7. The stock Fn colors carry alphaFF and therefore use full per-color intensity while retaining per-channel output scaling. Custom alphaFF matches that existing Fn behavior, including the ability to illuminate while normal main RGB is off. It does not automatically inherit the normal effect brightness slider.
