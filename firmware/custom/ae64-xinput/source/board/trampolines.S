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
