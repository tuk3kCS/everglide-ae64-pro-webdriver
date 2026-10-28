# Startup memory maps across all five versions

These addresses are reconstructed from startup instructions at application VMA `0x80021000`. Copy/zero call arguments are directly reconstructed; section names are inferred. The five files are application containers, not complete flash dumps.

| Firmware | Section initializer payload offset | Initial SP | TP / zero-region end | `.data` bytes | Zeroed `.bss` bytes | `.data` load address |
| --- | --- | --- | --- | ---: | ---: | --- |
| 0.0.5.0 | `0x13B52` | `0x00099400` | `0x0008D430` | 656 | 52896 | `0x8003C300` |
| 0.0.6.0 | `0x13B98` | `0x00098C00` | `0x0008D238` | 656 | 52392 | `0x8003C390` |
| 0.0.7.0 | `0x13D06` | `0x00098C00` | `0x0008D240` | 656 | 52400 | `0x8003C510` |
| 0.0.8.0 | `0x141AE` | `0x00098C00` | `0x0008D338` | 656 | 52648 | `0x8003C9E8` |
| 0.1.0.0 | `0x143B4` | `0x00098C00` | `0x0008D388` | 664 | 52720 | `0x8003CC00` |

All builds initialize GP to `0x00080B00`, copy `0xED8` bytes from `0x8002104A` to ILM address zero, and copy another `0x160` bytes into ILM at `0xED8`. The `.data` destination begins `0x80300`. In v0.1.0.0 the `.data` length grows from `0x290` to `0x298`; the zeroed region then begins `0x80598` instead of `0x80590`.

The startup stack pointer decreases by `0x800` between v0.0.5.0 and v0.0.6.0. This is a memory-layout change, not a measurement of stack utilization or evidence of a user-visible feature.

`startup-memory-maps.json` records every non-prologue call with reconstructed destination, source/fill, length and target. The calls whose bounds are equal have length zero. The first three startup calls configure caches; the fourth startup JAL at payload `0x2A` reaches the section initializer. Its immediate is a displacement and must be added to the instruction PC.

`reconstruct_startup_maps.py` reads the supplied linear disassembly text; it does not execute firmware. It accepts the analysis directory and an output path. The VMA has to have been established independently; changing it changes recovered addresses.
