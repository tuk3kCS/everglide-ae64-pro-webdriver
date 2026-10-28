/* Version-pinned Fn RGB trailer codec. SPDX-License-Identifier: MIT */
#ifndef AE64_FN_STORAGE_H
#define AE64_FN_STORAGE_H
#include "ae64_fn_rgb.h"
#define FN_STORAGE_COLORS (FN_RGB_LAYERS*FN_RGB_BYTES)
#define FN_STORAGE_BYTES 1136u
#define FN_STORAGE_HEADER 16u
#define FN_STORAGE_OFFSET 0x1700u
/* data ends in an enabled-layer bitmask and a zero reserved byte. */
struct fn_storage {
    _Alignas(4) uint8_t data[FN_STORAGE_BYTES];
    uint32_t revision;
    uint8_t profile;
    bool loaded;
};
typedef void (*fn_storage_program_fn)(uintptr_t,uint32_t,const uint8_t *);
uintptr_t fn_storage_address(uint8_t profile);
void fn_storage_clear(struct fn_storage *,uint8_t profile);
/* Invalid/missing trailers become a disabled, zero-color revision-0 profile. */
bool fn_storage_decode(struct fn_storage *,uint8_t profile,const uint8_t *image);
bool fn_storage_read_image(const uint8_t *image,uint8_t profile,uint8_t layer,
                          uint8_t *colors,bool *enabled,uint32_t *revision);
/* Caller has already used the native save routine to erase the selected pair.
 * Must be called in the serialized configuration task, with normal IRQ state.
 * Programs colors first, then the validating header, and checks mapped readback.
 * This function never erases, changes profile, or calls the native save itself. */
bool fn_storage_append(const struct fn_storage *,fn_storage_program_fn,const uint8_t *mapped_image);
#endif
