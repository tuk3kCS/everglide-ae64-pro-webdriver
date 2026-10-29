/* Original AGP1 configuration staging protocol. SPDX-License-Identifier: MIT */
#ifndef AE64_GAMEPAD_PROTOCOL_H
#define AE64_GAMEPAD_PROTOCOL_H
#include "ae64_gamepad_physical.h"

#define GP_WIRE_BYTES 208u
#define GP_VENDOR_BYTES 64u
#define GP_CAP_HID 1u
#define GP_CAP_XINPUT 2u
#define GP_CAP_PERSISTENT 4u
#define GP_CAP_USB_SWITCH 8u
#define GP_TRANSACTION_TIMEOUT_MS 5000u

enum gp_vendor_status { GP_VENDOR_OK, GP_VENDOR_UNSUPPORTED, GP_VENDOR_FORMAT,
    GP_VENDOR_CONFLICT, GP_VENDOR_CONFIG, GP_VENDOR_INCOMPLETE, GP_VENDOR_CRC,
    GP_VENDOR_BACKEND, GP_VENDOR_STORAGE };

/* Called in the application's serialized control-task context after complete
 * validation. The board integration must atomically install neutral/rearmed
 * mapping state and, only if advertised, persist safely. False means no change.
 * This callback must not leave partial state installed on failure.
 */
typedef bool (*gp_install_fn)(void *user, const struct gp_physical_config *config,
                              uint8_t transport, const uint8_t wire[GP_WIRE_BYTES]);
struct gp_vendor_context {
    uint8_t active[GP_WIRE_BYTES], staging[GP_WIRE_BYTES], received[GP_WIRE_BYTES];
    uint16_t max_travel_um[GP_KEY_COUNT];
    uint32_t revision, staged_revision, staged_crc, now_ms, last_activity_ms;
    uint8_t transaction[8];
    uint8_t capabilities;
    bool initialized, staging_active;
    gp_install_fn install;
    void *user;
};

uint32_t gp_crc32(const uint8_t *data, size_t length);
/* Decode physical millimeters expressed as integer micrometers. max_travel_um
 * comes from the measured board/calibration, never from web-page metadata.
 * The wire's per-binding maximum is an additional limit/hint, not calibration.
 */
bool gp_wire_decode(const uint8_t wire[GP_WIRE_BYTES], uint32_t revision,
                    const uint16_t max_travel_um[GP_KEY_COUNT],
                    struct gp_physical_config *config, uint8_t *transport);
bool gp_vendor_init(struct gp_vendor_context *context, const uint8_t initial[GP_WIRE_BYTES],
                    uint32_t revision, uint8_t capabilities,
                    const uint16_t max_travel_um[GP_KEY_COUNT],
                    gp_install_fn install, void *user);
/* Returns false for frames outside AGP1 so the caller can preserve stock dispatch.
 * Both arrays must be 64 bytes; no USB, flash or EEPROM is accessed here.
 * INFO/READ work without an install callback. BEGIN/WRITE/COMMIT require one.
 * Call serialization and actual USB transfer lifetime belong to the board port.
 */
bool gp_vendor_handle(struct gp_vendor_context *context,
                      const uint8_t request[GP_VENDOR_BYTES],
                      uint8_t reply[GP_VENDOR_BYTES], uint32_t now_ms);
#endif
