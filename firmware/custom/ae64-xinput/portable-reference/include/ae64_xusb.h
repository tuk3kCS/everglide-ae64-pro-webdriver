/* Original protocol backend. SPDX-License-Identifier: MIT */
#ifndef AE64_XUSB_H
#define AE64_XUSB_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "ae64_gamepad.h"

#define AE64_XUSB_INPUT_BYTES 20u
#define AE64_XUSB_INTERFACE_BYTES 40u
#define AE64_XUSB_MS_COMPAT_BYTES 40u
#define AE64_XUSB_MS_STRING_BYTES 18u
#define AE64_XUSB_VID 0x1CA6u
#define AE64_XUSB_PID 0x300Au

struct ae64_xusb_config {
    uint8_t interface_number, endpoint_in, endpoint_out;
    uint8_t interval_in, interval_out, ms_vendor_code;
};
struct ae64_usb_setup {
    uint8_t request_type, request;
    uint16_t value, index, length;
};
struct ae64_xusb_io {
    /* Must enqueue/start exactly length bytes, or return false without retaining data.
     * On true, data remains valid until ae64_xusb_in_complete/reset is called.
     * Integration must stop USB DMA/transfers before reset/disconnect releases data.
     */
    bool (*start_in)(void *user, uint8_t endpoint, const uint8_t *data, size_t length);
    void (*rumble)(void *user, uint8_t large_motor, uint8_t small_motor);
    void (*led)(void *user, uint8_t command);
    void *user;
};
struct ae64_xusb {
    struct ae64_xusb_config config;
    struct ae64_xusb_io io;
    bool configured, in_flight;
    uint8_t tx[AE64_XUSB_INPUT_BYTES];
};

bool ae64_xusb_config_valid(const struct ae64_xusb_config *config);
bool ae64_xusb_init(struct ae64_xusb *context, const struct ae64_xusb_config *config,
                    const struct ae64_xusb_io *io);
/* Compose this fragment into the full composite configuration; adjust its total
 * length/interface count and register both endpoints/control handler separately.
 * Nothing here registers hardware, allocates endpoints or enumerates a device.
 */
bool ae64_xusb_interface_descriptor(const struct ae64_xusb_config *config,
                                    uint8_t output[AE64_XUSB_INTERFACE_BYTES]);
void ae64_xusb_device_descriptor(uint8_t output[18]);
bool ae64_xusb_ms_string(const struct ae64_xusb_config *config,
                         uint8_t output[AE64_XUSB_MS_STRING_BYTES]);
bool ae64_xusb_ms_compatible_id(const struct ae64_xusb_config *config,
                               uint8_t output[AE64_XUSB_MS_COMPAT_BYTES]);
/* Implements only standard MS OS string EE and vendor Compatible ID index4.
 * Returns false for other requests, invalid recipient/fields or small buffers;
 * integration must delegate/STALL as appropriate. Not a complete XUSB EP0 stack.
 */
bool ae64_xusb_control(const struct ae64_xusb *context,
                       const struct ae64_usb_setup *setup,
                       uint8_t *output, size_t capacity, size_t *length);
void ae64_xusb_encode_input(const struct gp_report *report,
                            uint8_t output[AE64_XUSB_INPUT_BYTES]);
/* Serial calls or external synchronization required. No internal ISR/thread lock. */
void ae64_xusb_configured(struct ae64_xusb *context, bool configured);
bool ae64_xusb_submit(struct ae64_xusb *context, const struct gp_report *report);
void ae64_xusb_in_complete(struct ae64_xusb *context, uint8_t endpoint);
/* Complete packets only; driver must rearm its own persistent OUT buffer. */
bool ae64_xusb_out(struct ae64_xusb *context, uint8_t endpoint,
                   const uint8_t *data, size_t length);
#endif
