/* Version-specific append-only patch. Original bytes/addresses never move. */
OUTPUT_ARCH(riscv)
ENTRY(board_usb_initialize)
MEMORY {
    PATCH (rx) : ORIGIN = 0x8003D000, LENGTH = 0x23000
    STATE (rw) : ORIGIN = 0x0008A960, LENGTH = 0x1000
}
SECTIONS {
    .text : { *(.text .text.*) } > PATCH
    .rodata : { *(.rodata .rodata.* .srodata .srodata.*) } > PATCH
    .data : { *(.data .data.* .sdata .sdata.*) } > PATCH
    .bss (NOLOAD) : { __state_start = .; *(.bss .bss.* .sbss .sbss.* COMMON) __state_end = .; } > STATE
    /DISCARD/ : { *(.comment .eh_frame .eh_frame_hdr .riscv.attributes) }
}
ASSERT(SIZEOF(.data)==0, "Writable initializers require explicit startup copying")
ASSERT(__state_end<=0x8B960, "Patch state exceeds reserved stock heap memory")
stock_scan = 0x80026ECE;
stock_schedule = 0x800263F4;
stock_save3 = 0x80024C0E;
stock_save12 = 0x80024BDE;
stock_dispatch_continue = 0x8002E77A;
stock_ep0_continue = 0x80030756;
stock_add_interface = 0x80031494;
stock_add_endpoint = 0x800314CA;
stock_usb_initialize = 0x800315DE;
stock_usb_event = 0x8002F888;
stock_write = 0x800302E4;
stock_read = 0x8003033E;
stock_vendor_reply = 0x8002E4D8;
stock_tick = 0x80031706;
stock_fn_render = 0x8003556A;
stock_save8 = 0x80024BF4;
stock_fn_load_continue = 0x8002BE62;
stock_fn_save_continue = 0x8002BF9E;
stock_flash_program = 0x80033A42;
