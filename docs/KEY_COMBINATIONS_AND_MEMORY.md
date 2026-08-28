# Key combinations and onboard limits

This note separates confirmed packet structure from capacity estimates. It is based on the captured AE64 manufacturer driver, the implemented AE64 protocol, and the HE30 alternate driver's codecs.

## Key-combination representation

### HE30

An HE30 mapping is three bytes: `type`, `code1`, and `code2`. A combination uses:

- `type = 0x10`
- `code1 =` the standard eight-bit HID modifier mask
- `code2 =` one normal keyboard HID usage

The modifier bits are Left Ctrl, Left Shift, Left Alt, Left GUI, Right Ctrl, Right Shift, Right Alt, and Right GUI. They are state bits, not an event list. The current HE30 editor keeps a `modifierOrder` array only as workspace/export presentation metadata; the compiler writes only the combined mask byte.

The firmware therefore receives all selected modifiers and the base key together. It holds that report while the physical host key is held and releases it when the host key is released. There is no stored delay or fixed playback duration.

### AE64 Pro

An AE64 layer mapping is one 16-bit keycode. The captured manufacturer's combination editor stores:

```text
high byte = modifier mask
low byte  = normal keyboard trigger usage
```

The original interface exposes the lower four modifier bits. The alternative editor also exposes the standard right-side HID bits, based on the HE30 representation, as experimental options.

AE64 does not have HE30's separate `type = 0x10` discriminator. Other AE64 functions also occupy the 16-bit keycode namespace. For that reason, the alternative driver automatically recognizes captured lower-four-bit combinations, but recognizes an extended right-side combination only when its local profile metadata says that the driver created it. This prevents media, mouse, gamepad, and firmware functions from being mislabeled.

## Timing and order

Neither keyboard stores modifier order or inter-key delay for a key combination. The host sees one keyboard state containing the modifier byte and trigger usage. The next USB report carries the active state; a later report clears it after the host key is released.

The USB polling interval bounds only report delivery cadence: approximately 4 ms at 250 Hz, 1 ms at 1,000 Hz, and 0.125 ms at 8,000 Hz. It is not a programmed sequence duration and does not include scan, debounce, operating-system, or application latency.

Use a macro when press order, release order, or delays matter.

## HE30 capacity

Confirmed per-profile logical banks:

| Resource | Capacity | Notes |
| --- | ---: | --- |
| Layer mappings | 4 × 128 entries | Only 36 physical HE30 keys are exposed, yielding 144 usable host positions across four layers. |
| DKS | 32 entries | 1,024-byte bank; each DKS can drive four outputs across four travel stages. |
| Toggle | 32 entries | 128-byte bank. |
| Mod-Tap / Rappy Snappy / SOCD | 32 shared slots | Mod-Tap uses one slot; each paired action uses two reciprocal slots. |
| Macros | 32 macro IDs | 2,048-byte bank shared by all macro events. |
| Combination keys | No separate bank | Stored directly in a layer mapping, so the host-key positions are the limit. |

The macro bank has a 64-byte offset table, four fixed bytes, and four bytes per event. That leaves at most 495 encoded events shared by all 32 macro IDs. The current HE30 encoder validates the 32-macro count but should also reject event data beyond this shared byte limit instead of relying on final truncation.

The most complex HE30 real-time action is DKS: four output paths, four travel stages, and independently encoded down/up transitions. Macros are more complex temporally because every event has a 16-bit millisecond delay, but they play a sequence rather than responding continuously to switch travel.

## AE64 Pro capacity

Confirmed or strongly implied per active profile:

| Resource | Capacity | Confidence |
| --- | ---: | --- |
| Layer mappings | 64 physical keys × 4 layers = 256 | Confirmed by per-layer, per-coordinate 16-bit mapping commands. |
| Combination keys | Up to 256 mapping positions | They consume only their host layer mapping, not family `0x06`. |
| Higher-key records | 64 physical coordinates | Strongly implied by family `0x06` being addressed only by physical row/column, with one current mode per key. |
| Two-key SOCD / Rappy Snappy | Up to 32 pairs | Each pair occupies two reciprocal physical records. |
| Macro IDs | 16 | Reported by the captured AE64 macro-capacity response used by this project. |
| Macro capacity field | 960 | Firmware reports this value as `macroNumber`. Its exact storage unit is not named. The captured UI checks `16 slot records + edited slot action count <= 960`, so this driver enforces the same 944-action guard without calling the field bytes or total events. |

The AE64's most complex captured higher-key record is DKS, which stores four 16-bit outputs, four travel fields, and press/release dead-zone values. MPT stores three outputs at three depths. SOCD is the most complex paired behavior because two reciprocal records carry two outputs, a delay, and one of four resolution modes.

The 64-record higher-key limit and 256 combination-map limit are independent: a combination is a layer mapping, while DKS/MPT/MT/TGL/END/SOCD/RS is a physical higher-key mode. Whether every theoretical mixture is useful depends on how the firmware resolves an advanced physical mode against the active layer mapping.
