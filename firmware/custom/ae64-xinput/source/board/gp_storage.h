/* Version-pinned persistent gamepad trailer. SPDX-License-Identifier: MIT */
#ifndef AE64_GP_STORAGE_H
#define AE64_GP_STORAGE_H
#include "ae64_gamepad_protocol.h"

#define GP_STORAGE_PROFILES 4u
#define GP_STORAGE_OFFSET 0x1c00u
#define GP_STORAGE_HEADER 32u
#define GP_STORAGE_BYTES (GP_STORAGE_HEADER+GP_WIRE_BYTES)

typedef void (*gp_storage_program_fn)(uintptr_t,uint32_t,const uint8_t *);
uintptr_t gp_storage_address(uint8_t profile);
/* Missing, malformed or corrupt trailers return false without changing outputs.
 * Validation uses the protocol's 10000um ceiling, not live calibration. The board
 * must still validate the restored mapping against actual switch limits. */
bool gp_storage_read(const uint8_t *image,uint8_t profile,
                     uint8_t wire[GP_WIRE_BYTES],bool *usb_enabled,uint32_t *revision);
/* Caller has erased/saved the active native keymap and preserved its Fn trailer.
 * No erase, profile switch, heap allocation or device operation happens here.
 * Payload is word-aligned and programmed first; the validating header is last.
 * Call only from the serialized configuration task with normal IRQ state. */
bool gp_storage_append(uint8_t profile,const uint8_t wire[GP_WIRE_BYTES],
                       bool usb_enabled,uint32_t revision,
                       gp_storage_program_fn program,const uint8_t *mapped_image);
#endif
