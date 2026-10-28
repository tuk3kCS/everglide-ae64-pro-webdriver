/* Fn layer static RGB protocol. SPDX-License-Identifier: MIT */
#ifndef AE64_FN_RGB_H
#define AE64_FN_RGB_H
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#define FN_RGB_BYTES 378u
#define FN_RGB_PROFILES 4u
#define FN_RGB_LAYERS 3u
/* Backends run in the serialized native configuration task. Read must return
 * the committed revision; install must check expected_revision before saving. */
typedef bool (*fn_rgb_read_fn)(void *,uint8_t,uint8_t,uint8_t *,bool *,uint32_t *);
typedef bool (*fn_rgb_install_fn)(void *,uint8_t,uint8_t,const uint8_t *,bool,uint32_t);
struct fn_rgb_context {
    uint8_t staging[FN_RGB_BYTES],received[(FN_RGB_BYTES+7)/8],token[8];
    uint32_t revision,checksum,last_activity;
    uint8_t profile,layer;
    bool enabled,active,persistent;
    fn_rgb_read_fn read;
    fn_rgb_install_fn install;
    void *user;
};
void fn_rgb_init(struct fn_rgb_context *,fn_rgb_read_fn,fn_rgb_install_fn,void *,bool);
bool fn_rgb_handle(struct fn_rgb_context *,const uint8_t[64],uint8_t[64],uint32_t);
#endif
