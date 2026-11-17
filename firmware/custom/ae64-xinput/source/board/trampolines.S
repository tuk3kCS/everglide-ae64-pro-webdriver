/* Original version-pinned trampolines. SPDX-License-Identifier: MIT */
.option norelax
.section .text.trampolines,"ax",@progbits
.balign 4
.globl stock_dispatch_original
.type stock_dispatch_original,@function
stock_dispatch_original:
    jal t0, stock_save3
    j stock_dispatch_continue
.size stock_dispatch_original, .-stock_dispatch_original
.balign 4
.globl stock_ep0_original
.type stock_ep0_original,@function
stock_ep0_original:
    jal t0, stock_save12
    j stock_ep0_continue
.size stock_ep0_original, .-stock_ep0_original
.balign 4
.globl stock_fn_load_original
.type stock_fn_load_original,@function
stock_fn_load_original:
    jal t0, stock_save8
    j stock_fn_load_continue
.size stock_fn_load_original, .-stock_fn_load_original
.balign 4
.globl stock_fn_save_original
.type stock_fn_save_original,@function
stock_fn_save_original:
    jal t0, stock_save3
    j stock_fn_save_continue
.size stock_fn_save_original, .-stock_fn_save_original

.balign 4
.globl stock_keyboard_press_original
.type stock_keyboard_press_original,@function
stock_keyboard_press_original:
    addi a5, a0, -4
    j stock_keyboard_press_continue
.size stock_keyboard_press_original, .-stock_keyboard_press_original
.balign 4
.globl stock_keyboard_release_original
.type stock_keyboard_release_original,@function
stock_keyboard_release_original:
    jal t0, stock_save3
    j stock_keyboard_release_continue
.size stock_keyboard_release_original, .-stock_keyboard_release_original
.balign 4
.globl stock_advanced_key_original
.type stock_advanced_key_original,@function
stock_advanced_key_original:
    jal t0, stock_save3
    j stock_advanced_key_continue
.size stock_advanced_key_original, .-stock_advanced_key_original

/* These injection sites are inside a native function, not ABI call boundaries.
 * Preserve every caller register and the exact stack position, then reproduce
 * the displaced instruction. The parent keeps its original RA in its frame. */
.macro save_callers
    addi sp,sp,-64
    sw ra,0(sp)
    sw t0,4(sp)
    sw t1,8(sp)
    sw t2,12(sp)
    sw t3,16(sp)
    sw t4,20(sp)
    sw t5,24(sp)
    sw t6,28(sp)
    sw a0,32(sp)
    sw a1,36(sp)
    sw a2,40(sp)
    sw a3,44(sp)
    sw a4,48(sp)
    sw a5,52(sp)
    sw a6,56(sp)
    sw a7,60(sp)
.endm
.macro restore_callers
    lw ra,0(sp)
    lw t0,4(sp)
    lw t1,8(sp)
    lw t2,12(sp)
    lw t3,16(sp)
    lw t4,20(sp)
    lw t5,24(sp)
    lw t6,28(sp)
    lw a0,32(sp)
    lw a1,36(sp)
    lw a2,40(sp)
    lw a3,44(sp)
    lw a4,48(sp)
    lw a5,52(sp)
    lw a6,56(sp)
    lw a7,60(sp)
    addi sp,sp,64
.endm
.balign 4
.globl board_key_context_trampoline
.type board_key_context_trampoline,@function
board_key_context_trampoline:
    andi a5,a5,0x82
    beqz a5,1f
    save_callers
    mv a0,s0
    call board_key_context
    restore_callers
1:
    ret
.size board_key_context_trampoline, .-board_key_context_trampoline
.balign 4
.globl board_timed_context_trampoline
.type board_timed_context_trampoline,@function
board_timed_context_trampoline:
    lbu a0,0x11(s9)
    addi a0,a0,-3
    beqz a0,1f
    addi a0,a0,3
    ret
1:
    addi a0,a0,3
    save_callers
    mv a0,s11
    call board_key_context
    restore_callers
    ret
.size board_timed_context_trampoline, .-board_timed_context_trampoline
.balign 4
.globl board_key_action_trampoline
.type board_key_action_trampoline,@function
board_key_action_trampoline:
    save_callers
    lhu a1,0(a5)
    mv a0,s0
    call board_key_action
    mv s3,a0
    restore_callers
    ret
.size board_key_action_trampoline, .-board_key_action_trampoline
