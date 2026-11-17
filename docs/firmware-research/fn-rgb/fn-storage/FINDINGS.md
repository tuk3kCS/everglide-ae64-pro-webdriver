# Fn RGB storage findings — stock v0.1.0.0

Static analysis of SHA256 `3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d`. Payload offset begins at container0x1000; code mapping80021000. No flash or configuration operations were sent to the keyboard for this analysis. Evidence: `native-excerpts.txt`, original payload, existing boot/helper research.

## Proven native layout

Payload0x1958C / VMA8003A58C contains four 12-byte profile records:

| Profile | Settings/KV page | Macro page | Keymap/action allocation |
| --- | --- | --- | --- |
| 0 | 800B0000 | 800B1000 | 800B2000..800B3FFF |
| 1 | 800B4000 | 800B5000 | 800B6000..800B7FFF |
| 2 | 800B8000 | 800B9000 | 800BA000..800BBFFF |
| 3 | 800BC000 | 800BD000 | 800BE000..800BFFFF |

The first two page descriptions follow their call sites and are semantic inferences; their addresses are exact bytes. The third allocation's size and payload footprint are directly established by the load/save instructions below.

`AE5E` loads active-profile keymap/action state. It reads profile index from RAM82BA8, selects table third field, checks two native magic words, then reads `0x16A4` bytes from allocation+8 into84F28. This is126 matrix slots ×46 bytes. Other branch supplies defaults. Native OS bank is82BA9 (0 Windows,1 Mac), independently confirmed by Fn-rendering agent; it is not a second profile index.

`AF9A` saves that native block: erases0x2000 bytes at table third field, programs0x16A4 bytes at+8, then writes8-byte native header. Thus known native contents end at offset0x16AC. Tail `[0x16AC,0x2000)` has0x954=2388 bytes perprofile. The requested3×126×3=1134 RGB bytes plus2 enable/reserved bytes plus16-byte header fit in1152 bytes. Placing the trailer at+0x1700 ends+0x1B80, leaving0x480=1152 bytes before allocation end and0x54-byte gap after native payload.

Native user-reset functionB376 erases profile allocations on its full-reset path, so custom trailers naturally clear too. Native AF9A will erase custom trailers on every ordinary keymap save; it MUST be wrapped to append the current-profile cached trailer after original save. Native AE5E should be wrapped to reload the custom cache after original load/defaults. Future factory firmware uses the same erase and can wipe trailers; user should export profiles before changing firmware. The safety boundary is this pinned stock image, not a guarantee about future vendor builds or unseen bootloader routines.

## Safe integration scope

Only the currently selected native profile can be persisted through AF9A: that function serializes current RAM into the selected slot. Temporarily replacing82BA8 to save a different profile would copy the wrong native keymaps. Reject inactive-profile custom writes; allow inactive-profile reads directly from validated mapped trailers. Let the existing profile selection workflow load another profile before editing it.

Entry patch signatures / trampoline replay:

- AF9A bytes `ef825fc7`: replay `jal t0,80024C0E` (stock_save3), continue8002BF9E.
- AE5E bytes `ef827fd9`: replay `jal t0,80024BF4` (s0..s6,ra save helper), continue8002BE62.
- Native program wrapper VMA80033A42 / payload12A42 takes `(address,length_bytes,source)`. It rounds the requested length to words, so source and lengths must be padded/aligned. Trailer1152 bytes is word aligned.
- Native program leafDD5C masks address to20bits, disables MIE during platform programming, and unconditionally enables MIE when returning. Do not enclose these calls in an outer IRQ lock. Use serialized application configuration-task context, like native saves.
- The wrappers do not expose a verified useful error result. Treat mapped readback validation as required. A failed append disables the profile on next load; it cannot promise rollback through a power interruption.

Native save is itself erase-and-rewrite, so power loss while saving can damage the current native profile as well. This extension inherits that native save boundary; it is not a dual-bank atomic storage implementation. No bootloader writes or flash write experiments were used to establish this layout.

## SRAM

Original native heap87964..8B964=16384 bytes. Existing gamepad patch changes heap end to8A960, leaves12284 bytes and reserves4096 bytes at8A960..8B960. Existing2176-byte BSS + Fn protocol context +1144-byte active-profile cache should fit that reservation (final linked section size is authoritative). Only current profile is cached; all four profiles live in their existing flash allocations. No heap expansion or guessed additional flash sector is required.

Code added independently: `source/board/fn_storage.c`, `fn_storage.h`, `test_fn_storage.c`. Storage codec header16 bytes: magicFNR1,version1,profile,length1136,revision32,CRC32. CRC includes first12 header bytes and all1136 data bytes. Payload1134 RGB bytes then3-bit enabled mask and zero reserved byte. Writer programs payload first and valid header last, verifies mapped readback, never erases or changes native profile itself. Host test:40084 checks passed; includes every single bit corruption of1152-byte image, all4profiles×3layers, failed body/header writes, defaults and alignment. These are offline tests, not hardware persistence validation.
