/* Original experimental board port. SPDX-License-Identifier: MIT */
#ifndef AE64_BOARD_PORT_H
#define AE64_BOARD_PORT_H
#include "ae64_gamepad_protocol.h"
#include "ae64_xusb.h"
#include "ae64_fn_rgb.h"
struct stock_interface {
    int (*class_interface)(uint8_t, const struct ae64_usb_setup *, uint8_t **, uint32_t *);
    int (*class_endpoint)(uint8_t, const struct ae64_usb_setup *, uint8_t **, uint32_t *);
    int (*vendor)(uint8_t, const struct ae64_usb_setup *, uint8_t **, uint32_t *);
    void (*notify)(uint8_t, uint8_t, void *);
    const uint8_t *hid_descriptor;
    uint32_t hid_length;
    uint8_t number;
};
struct stock_endpoint { uint8_t address; void (*callback)(uint8_t, uint8_t, uint32_t); };
void stock_scan(void);
void stock_schedule(void);
void stock_fn_render(void);
void stock_fn_load_original(void);
void stock_fn_save_original(void);
void stock_flash_program(uintptr_t,uint32_t,const uint8_t *);
void stock_dispatch_original(void);
bool stock_ep0_original(uint8_t, const struct ae64_usb_setup *, uint8_t **, uint32_t *);
void stock_add_interface(uint8_t, struct stock_interface *);
void stock_add_endpoint(uint8_t, const struct stock_endpoint *);
int stock_usb_initialize(uint8_t, uintptr_t, void (*)(uint8_t,uint8_t));
void stock_usb_event(uint8_t,uint8_t);
int stock_write(uint8_t,uint8_t,const uint8_t *,uint32_t);
int stock_read(uint8_t,uint8_t,uint8_t *,uint32_t);
int stock_vendor_reply(const uint8_t *);
uint32_t stock_tick(void);
#ifdef AE64_HOST_TEST
void *test_stock_ram(uintptr_t);
#define RAM(a) test_stock_ram((uintptr_t)(a))
static inline uint32_t irq_lock(void) { return 0; }
static inline void irq_unlock(uint32_t saved) { (void)saved; }
const struct gp_report *board_test_report(void);
bool board_test_install(const uint8_t *wire);
#else
#define RAM(a) ((void *)(uintptr_t)(a))
static inline uint32_t irq_lock(void) {
    uint32_t saved;
    __asm__ volatile("csrrci %0, mstatus, 8" : "=r"(saved) :: "memory");
    return saved;
}
static inline void irq_unlock(uint32_t saved) {
    if(saved & 8u) __asm__ volatile("csrsi mstatus, 8" ::: "memory");
}
#endif
void board_scan_hook(void);
void board_schedule_hook(void);
void board_fn_render_hook(void);
void board_fn_load_hook(void);
void board_fn_save_hook(void);
void board_dispatch_hook(void);
int board_usb_initialize(uint8_t,uintptr_t,void (*)(uint8_t,uint8_t));
bool board_ep0_hook(uint8_t,const struct ae64_usb_setup *,uint8_t **,uint32_t *);
const uint8_t *board_configuration(uint8_t);
const uint8_t *board_other_speed(uint8_t);
const uint8_t *board_device_descriptor(uint8_t);
#endif
