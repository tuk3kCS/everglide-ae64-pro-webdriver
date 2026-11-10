/* Original experimental AE64 Pro v0.1.0.0 patch. SPDX-License-Identifier: MIT
 * Stock addresses/layouts are static RE evidence, not hardware validation.
 */
#include "board_port.h"
#include "default_profile.h"
#include "fn_storage.h"
#include "gp_storage.h"
#include "keyboard_policy.h"

#define RECORD_BASE UINT32_C(0x82bb8)
#define PERFORMANCE_BASE UINT32_C(0x865cc)
#define STOCK_FLAGS UINT32_C(0x8d2d0)
#define MAIN_RGB_MATRIX UINT32_C(0x8cf1c)
#define SHARED_RGB_FLASH UINT32_C(0x800a2000)
#define KEYBOARD_REPORT_FLAGS UINT32_C(0x8081c)
#define GP UINT32_C(0x80b00)
#define XUSB_IN 0x85u
#define XUSB_OUT 0x05u
#define MS_VENDOR 0x20u
#define CONFIG_LENGTH 131u
#define USB_COMMAND 0x140u
#define USB_STATUS 0x144u
#define USB_INTERRUPTS 0x148u
#define USB_PRIME 0x1b0u
#define USB_FLUSH 0x1b4u
#define USB_ENDPOINT_STATUS 0x1b8u
#define USB_SOF (1u<<7)
#define USB_VENDOR_IN (1u<<19)
#define NATIVE_USB_STATE UINT32_C(0x80584)
static const uint8_t row_lengths[5]={14,14,13,14,9};
/* Physical-key order from pinned 03:05 layout table at payload 0x1A734.
 * The bottom three sensor rows contain holes; logical indices remain 0..63. */
static const uint8_t matrix_columns[5][14]={
    {0,1,2,3,4,5,6,7,8,9,10,11,12,13},
    {0,1,2,3,4,5,6,7,8,9,10,11,12,13},
    {0,1,2,3,4,5,6,7,8,9,10,11,13},
    {0,2,3,4,5,6,7,8,9,10,11,12,13,14},
    {0,1,2,6,9,10,12,13,14}
};
static const struct ae64_xusb_config usb_config={3,XUSB_IN,XUSB_OUT,1,1,MS_VENDOR};

struct board_state {
    struct gp_vendor_context vendor;
    struct gp_physical_config mapping;
    struct gp_physical_context physical;
    struct ae64_xusb xusb;
    struct gp_report report;
    uint16_t travel[64], maximum[64];
    uint64_t bound_keys,previous_suppression;
    struct stock_interface interface;
    struct stock_endpoint endpoint_in,endpoint_out;
    uint8_t configuration[CONFIG_LENGTH], other[CONFIG_LENGTH];
    uint8_t os_string[18],compatible[40];
    uint8_t device_descriptor[18];
    uint8_t reply[64];
    /* HPM endpoint storage remains live through asynchronous completion. */
    _Alignas(64) uint8_t out[64];
    uint32_t last_submit,last_keyboard_refresh,physical_generation;
    uintptr_t usb_base;
    uint32_t usb_revision,usb_requested_at,usb_phase_at,usb_interrupt_mask;
    uint8_t usb_phase;
    uint8_t usb_native_status;
    uint8_t profile;
    uint8_t key_context,fn_display_layer;
    uint8_t fn_origin[64];
    bool fn_tracking;
    bool profile_valid;
    bool usb_enabled,usb_target,usb_preference_enabled;
    bool initialized,suspended,out_armed;
    void (*original_event)(uint8_t,uint8_t);
};
static struct board_state state;
static struct fn_rgb_context fn_protocol;
static struct fn_storage fn_colors;
static bool fn_save_ok;
static uint8_t main_rgb_loaded_profile;
static void gp_load_current(void);
static void mapping_changed(void);
static void keyboard_policy_update(void);
static bool install(void *,const struct gp_physical_config *,uint8_t,const uint8_t[208]);
static uint64_t keyboard_suppression(void);
static void fn_transition(void);
static void fn_reconcile(void);
static bool save_profile(const uint8_t *,uint32_t,bool,uint32_t);
#ifndef AE64_HOST_TEST
_Static_assert(sizeof(struct stock_interface)==28,"Stock RV32 interface ABI");
_Static_assert(sizeof(struct stock_endpoint)==8,"Stock RV32 endpoint ABI");
_Static_assert(sizeof(struct board_state)<=4096,"Reserved state memory");
#endif

static uint8_t load8(uintptr_t a) { return *(volatile uint8_t *)RAM(a); }
static uint16_t load16(uintptr_t a) { return *(volatile uint16_t *)RAM(a); }
static uint32_t load32(uintptr_t a) { return *(volatile uint32_t *)RAM(a); }
static void store8(uintptr_t a,uint8_t v) { *(volatile uint8_t *)RAM(a)=v; }
static void store32(uintptr_t a,uint32_t v) { *(volatile uint32_t *)RAM(a)=v; }
static void copy(void *dst,const void *src,size_t n) {
    uint8_t *d=dst;const uint8_t *s=src;while(n--)*d++=*s++;
}
static void clear(void *dst,size_t n) { uint8_t *d=dst;while(n--)*d++=0; }
static void reset_physical(void) {
    state.physical_generation++;
    gp_physical_reset(&state.physical);state.report=(struct gp_report){0};
}
static bool xbox_active(void) { return state.usb_enabled && state.usb_phase==0; }
static void usb_persona(bool enabled) {
    state.usb_enabled=enabled;
    state.previous_suppression=0;
    /* Keep stock VID/PID/strings and distinguish Windows OS-descriptor caches. */
    copy(state.device_descriptor,RAM(0x80374),18);
    state.device_descriptor[12]=enabled?13:14;state.device_descriptor[13]=1;
    ae64_xusb_ms_compatible_id(&usb_config,state.compatible);
    if(!enabled) { clear(state.compatible,40);state.compatible[0]=16;state.compatible[5]=1;state.compatible[6]=4; }
}
static void usb_switch_tick(uint32_t now) {
    if(state.usb_phase==1) {
        /* Replies are queued by stock_vendor_reply, then submitted asynchronously
         * on EP3. Never unplug the ACK while it is queued or owned by USB DMA. */
        if((uint32_t)(now-state.usb_requested_at)>1500) {
            state.usb_target=state.usb_enabled;state.usb_phase=0;return;
        }
        if((uint32_t)(now-state.usb_requested_at)<30 ||
           load8(0x8d2b0)!=load8(0x8d2b1) ||
           ((load32(state.usb_base+USB_PRIME)|load32(state.usb_base+USB_ENDPOINT_STATUS))&USB_VENDOR_IN))return;
        /* HPM DCD disconnect sequence: first bring the PHY to full speed.
         * SOF is checked on later scheduler passes, with a bounded fallback. */
        store32(state.usb_base+USB_COMMAND,load32(state.usb_base+USB_COMMAND)&~1u);
        store32(state.usb_base+USB_COMMAND,load32(state.usb_base+USB_COMMAND)|1u);
        store32(state.usb_base+USB_STATUS,USB_SOF);
        state.usb_phase=3;state.usb_phase_at=now;
    } else if(state.usb_phase==3) {
        if(!(load32(state.usb_base+USB_STATUS)&USB_SOF) && (uint32_t)(now-state.usb_phase_at)<20)return;
        state.usb_interrupt_mask=load32(state.usb_base+USB_INTERRUPTS);
        /* Native keyboard/vendor writers require state 3. Stop new priming
         * while all endpoints are being flushed, without invoking reset twice. */
        state.usb_native_status=load8(NATIVE_USB_STATE);store8(NATIVE_USB_STATE,1);
        store32(state.usb_base+USB_INTERRUPTS,0);
        store32(state.usb_base+USB_COMMAND,load32(state.usb_base+USB_COMMAND)&~1u);
        state.suspended=true;
        store32(state.usb_base+USB_FLUSH,UINT32_MAX);
        state.usb_phase=2;state.usb_phase_at=now;
        /* Do not clear/reuse asynchronous transfer buffers here. Native host
         * bus-reset cleanup quiesces endpoints before event() releases them. */
    } else if(state.usb_phase==2 && (uint32_t)(now-state.usb_phase_at)>=250) {
        /* EP0 can own the descriptor buffers too. Only mutate them after all
         * endpoint DMA is quiescent. Failed flushes retain the old persona. */
        uint32_t active=load32(state.usb_base+USB_FLUSH)|load32(state.usb_base+USB_PRIME)|load32(state.usb_base+USB_ENDPOINT_STATUS);
        if(active && (uint32_t)(now-state.usb_phase_at)<1000)return;
        if(active) { state.usb_target=state.usb_enabled;store8(NATIVE_USB_STATE,state.usb_native_status); }
        else usb_persona(state.usb_target);
        state.usb_phase=0;
        store32(state.usb_base+USB_INTERRUPTS,state.usb_interrupt_mask);
        store32(state.usb_base+USB_COMMAND,load32(state.usb_base+USB_COMMAND)|1u);
    }
}
static void usb_put32(uint8_t *p,uint32_t v) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i)); }
static uint32_t get32(const uint8_t *p) { return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24; }
static bool usb_switch_request(const uint8_t *q,uint8_t *r,uint32_t now) {
    if(q[0]!=0x10 || (q[1]!=0x26 && q[1]!=0x27) ||
       q[4]!='A'||q[5]!='G'||q[6]!='P'||q[7]!='1')return false;
    clear(r,64);copy(r,q,8);uint8_t status=GP_VENDOR_OK;
    if(q[2]!=1||q[8]||q[9]!=(q[1]==0x26?0:10))status=GP_VENDOR_FORMAT;
    else if(q[1]==0x27) {
        if(get32(q+10)!=0x0030000au||q[14]>1||q[15])status=GP_VENDOR_FORMAT;
        else if(get32(q+16)!=state.usb_revision||state.usb_phase)status=GP_VENDOR_CONFLICT;
        else {
            if(state.vendor.staging_active && (uint32_t)(now-state.vendor.last_activity_ms)>GP_TRANSACTION_TIMEOUT_MS)state.vendor.staging_active=false;
            if(fn_protocol.active && (uint32_t)(now-fn_protocol.last_activity)>GP_TRANSACTION_TIMEOUT_MS)fn_protocol.active=false;
            if(state.vendor.staging_active||fn_protocol.active)status=GP_VENDOR_CONFLICT;
            else if(state.usb_enabled!=(bool)q[14] || state.usb_preference_enabled!=(bool)q[14]) {
                if(!state.initialized||!state.profile_valid||state.profile!=load8(0x82ba8))status=GP_VENDOR_CONFLICT;
                else if(!save_profile(state.vendor.active,state.vendor.revision,(bool)q[14],state.usb_revision+1u))status=GP_VENDOR_STORAGE;
                else {
                    state.usb_preference_enabled=state.usb_target=(bool)q[14];state.usb_revision++;
                    state.usb_requested_at=stock_tick();state.usb_phase=1;
                    reset_physical();
                }
            }
        }
    }
    r[8]=status;
    if(!status) {
        r[9]=12;usb_put32(r+10,0x0030000au);r[14]=1;r[15]=state.usb_enabled;
        r[16]=state.usb_target;r[17]=state.usb_phase==3?1:state.usb_phase;usb_put32(r+18,state.usb_revision);
    }
    return true;
}
static const uint8_t *fn_image(uint8_t profile) { return RAM(fn_storage_address(profile)); }
static void fn_load_current(void) {
    uint8_t profile=load8(0x82ba8);
    if(profile<4)fn_storage_decode(&fn_colors,profile,fn_image(profile));
    else fn_colors.loaded=false;
}
static void fn_ensure_current(void) {
    if(!fn_colors.loaded||fn_colors.profile!=load8(0x82ba8))fn_load_current();
}
static const uint8_t *main_rgb_image(uint8_t profile) { return RAM(main_rgb_address(profile)); }
static void main_rgb_legacy(uint8_t *colors) {
    if(load32(SHARED_RGB_FLASH)==UINT32_C(0x20250508)&&load32(SHARED_RGB_FLASH+4)==UINT32_C(0x20260929))
        copy(colors,RAM(SHARED_RGB_FLASH+0x200u),MAIN_RGB_BYTES);
    else clear(colors,MAIN_RGB_BYTES);
}
static void main_rgb_load_current(void) {
    uint8_t profile=load8(0x82ba8);
    main_rgb_loaded_profile=profile;
    if(profile>=FN_RGB_PROFILES)return;
    uint8_t *matrix=RAM(MAIN_RGB_MATRIX);uint32_t revision;
    if(!main_rgb_read(main_rgb_image(profile),profile,matrix,&revision))main_rgb_legacy(matrix);
}
void board_rgb_save_shared(void) {
    /* The native strip save erases and rewrites both areas. Save the original
     * shared Main colors there so unconfigured slots keep the same baseline. */
    uint8_t active[MAIN_RGB_BYTES],*matrix=RAM(MAIN_RGB_MATRIX);
    copy(active,matrix,sizeof(active));main_rgb_legacy(matrix);
    stock_rgb_save_original();
    copy(matrix,active,sizeof(active));
}
void board_fn_load_hook(void) {
    stock_fn_load_original();fn_load_current();main_rgb_load_current();
    /* A profile switch while Fn is held must still release its original
     * physical press, even if the newly loaded layer maps that key differently. */
    fn_reconcile();fn_transition();
    store32(0x8d260,0);
    if(state.initialized)gp_load_current();
}
static bool save_active_trailers(const uint8_t *wire,uint32_t revision,bool enabled,uint32_t usb_revision,
                                 const uint8_t *new_rgb,uint32_t rgb_revision) {
    fn_ensure_current();
    const uint8_t profile=load8(0x82ba8);
    if(!fn_colors.loaded||fn_colors.profile!=profile)return false;
    _Alignas(4) uint8_t previous_rgb[MAIN_RGB_BYTES];
    if(!new_rgb&&main_rgb_read(main_rgb_image(profile),profile,previous_rgb,&rgb_revision))new_rgb=previous_rgb;
    stock_fn_save_original();
    /* Verify each trailer independently. An earlier failure must not skip
     * the other records after the native erase. */
    bool fn_ok=fn_storage_append(&fn_colors,stock_flash_program,fn_image(profile));
    bool gp_ok=!wire||gp_storage_append(profile,wire,enabled,revision,stock_flash_program,RAM(gp_storage_address(profile)));
    bool usb_ok=!wire||gp_usb_storage_append(profile,enabled,usb_revision,stock_flash_program,RAM(gp_usb_storage_address(profile)));
    bool rgb_ok=!new_rgb||main_rgb_append(profile,new_rgb,rgb_revision,stock_flash_program,main_rgb_image(profile));
    return fn_ok&&gp_ok&&usb_ok&&rgb_ok;
}
void board_fn_save_hook(void) {
    if(state.initialized && state.profile!=load8(0x82ba8))gp_load_current();
    const uint8_t *wire=state.initialized&&state.profile_valid?state.vendor.active:0;
    fn_save_ok=save_active_trailers(wire,state.vendor.revision,state.usb_preference_enabled,state.usb_revision,0,0);
}
static bool save_profile(const uint8_t *wire,uint32_t revision,bool enabled,uint32_t usb_revision) {
    return state.profile_valid&&state.profile==load8(0x82ba8)&&
        save_active_trailers(wire,revision,enabled,usb_revision,0,0);
}
static void gp_load_current(void) {
    const uint8_t profile=load8(0x82ba8);
    _Alignas(4) uint8_t wire[GP_WIRE_BYTES];
    uint32_t disk_revision=1;bool reserved_usb_default;
    bool restored=profile<4 && gp_storage_read(RAM(gp_storage_address(profile)),profile,wire,&reserved_usb_default,&disk_revision);
    if(!restored)copy(wire,default_profile,GP_WIRE_BYTES);
    uint16_t ceiling[GP_KEY_COUNT];for(unsigned i=0;i<GP_KEY_COUNT;i++)ceiling[i]=10000;
    uint32_t revision=state.vendor.initialized?state.vendor.revision+1u:disk_revision;
    struct gp_physical_config mapping;uint8_t transport;
    if(!gp_wire_decode(wire,revision,ceiling,&mapping,&transport) || (transport!=GP_CAP_XINPUT&&mapping.mode!=GP_OFF)) {
        copy(wire,default_profile,GP_WIRE_BYTES);
        gp_wire_decode(wire,revision,ceiling,&mapping,&transport);
    }
    uint32_t saved=irq_lock();
    state.mapping=mapping;mapping_changed();state.profile=profile;state.profile_valid=profile<4;
    gp_vendor_init(&state.vendor,wire,revision,GP_CAP_XINPUT|GP_CAP_USB_SWITCH|GP_CAP_USB_PERSISTENT|GP_CAP_PERSISTENT,ceiling,install,0);
    reset_physical();
    irq_unlock(saved);
}
static bool fn_read(void *user,uint8_t profile,uint8_t layer,uint8_t *colors,bool *enabled,uint32_t *revision) {
    (void)user;
    if(layer==0&&profile<FN_RGB_PROFILES) {
        *enabled=true;
        if(!main_rgb_read(main_rgb_image(profile),profile,colors,revision)) {
            main_rgb_legacy(colors);*revision=0;
            for(unsigned i=3;i<MAIN_RGB_BYTES;i+=4)colors[i]=colors[i]==255?255:0;
        }
        return true;
    }
    return fn_storage_read_image(fn_image(profile),profile,layer,colors,enabled,revision);
}
static bool fn_install(void *user,uint8_t profile,uint8_t layer,const uint8_t *colors,bool enabled,uint32_t revision) {
    (void)user;
    /* The native save serializes the active keymap. Never change this index
     * merely to save another profile, which would overwrite its keymap. */
    if(profile!=load8(0x82ba8)||profile>=4||layer>3)return false;
    if(layer==0) {
        if(!enabled||main_rgb_loaded_profile!=profile||!state.profile_valid||state.profile!=profile)return false;
        for(unsigned i=3;i<MAIN_RGB_BYTES;i+=4)if(colors[i]&&colors[i]!=255)return false;
        if(!save_active_trailers(state.vendor.active,state.vendor.revision,state.usb_preference_enabled,state.usb_revision,colors,revision+1u))return false;
        copy(RAM(MAIN_RGB_MATRIX),colors,MAIN_RGB_BYTES);
        store32(0x8d260,0);
        return true;
    }
    fn_ensure_current();
    if(!fn_colors.loaded||fn_colors.revision!=revision)return false;
    copy(fn_colors.data+(layer-1u)*FN_RGB_BYTES,colors,FN_RGB_BYTES);
    uint8_t bit=(uint8_t)(1u<<(layer-1u));
    if(enabled)fn_colors.data[FN_STORAGE_COLORS]|=bit;
    else fn_colors.data[FN_STORAGE_COLORS]&=(uint8_t)~bit;
    fn_colors.revision++;
    /* Native flash helpers manage interrupts themselves. Keep this outside
     * irq_lock: one native helper unconditionally reenables interrupts. */
    board_fn_save_hook();
    if(!fn_save_ok)fn_load_current();
    store32(0x8d260,0);
    return fn_save_ok;
}
void board_fn_render_hook(void) {
    stock_fn_render();fn_ensure_current();
    uint8_t layer=load8(0x82b9d);
    if(!fn_colors.loaded||!(load32(STOCK_FLAGS)&0x20u)||layer<1||layer>3||
       !(fn_colors.data[FN_STORAGE_COLORS]&(1u<<(layer-1u))))return;
    const uint8_t *colors=fn_colors.data+(layer-1u)*FN_RGB_BYTES;
    for(unsigned row=0;row<6;row++)for(unsigned col=0;col<15;col++) {
        const uint8_t *c=colors+(row*21u+col)*3u;
        store32(0x8d084u+(row*15u+col)*4u,UINT32_C(0xff000000)|(uint32_t)c[0]<<16|(uint32_t)c[1]<<8|c[2]);
    }
}
static uintptr_t record(unsigned row,unsigned column) { return RECORD_BASE+row*0x5e8u+column*0x48u; }
static uintptr_t performance(unsigned row,unsigned column) { return PERFORMANCE_BASE+row*0xd2u+column*10u; }
static uint8_t record_key(uintptr_t address) {
    if(address<RECORD_BASE || address>=RECORD_BASE+6u*0x5e8u)return GP_NONE;
    unsigned delta=(unsigned)(address-RECORD_BASE),row=delta/0x5e8u,col=(delta%0x5e8u)/0x48u;
    if(row<1 || row>5 || delta%0x48u)return GP_NONE;
    unsigned key=0;for(unsigned i=1;i<row;i++)key+=row_lengths[i-1];
    for(unsigned slot=0;slot<row_lengths[row-1];slot++)
        if(matrix_columns[row-1][slot]==col)return (uint8_t)(key+slot);
    return GP_NONE;
}
static uintptr_t key_record(unsigned key) {
    unsigned row=1;while(key>=row_lengths[row-1])key-=row_lengths[row++-1];
    return record(row,matrix_columns[row-1][key]);
}
void board_key_context(uintptr_t address) { state.key_context=record_key(address); }
void board_keyboard_press_hook(uint32_t usage,uint32_t owner) {
    /* Native owner bytes collide between physical positions. Only the exact
     * record context can distinguish a mapped A from an unbound A alias. */
    if(state.initialized && state.key_context<64 &&
       (keyboard_suppression()&(UINT64_C(1)<<state.key_context)))return;
    if(state.initialized && state.key_context<64)owner=state.key_context+1u;
    stock_keyboard_press_original(usage,owner);
}
void board_keyboard_release_hook(uint32_t usage,uint32_t owner) {
    /* Give each physical source its own ledger identity on both edges.
     * Suppressed releases then cannot remove an unbound alias with the same
     * usage and a colliding native row/column product token. */
    if(state.initialized && state.key_context<64)owner=state.key_context+1u;
    stock_keyboard_release_original(usage,owner);
}
void board_advanced_key_hook(uintptr_t address,uintptr_t settings,uint32_t owner) {
    uint8_t previous=state.key_context;board_key_context(address);
    if(!state.initialized || state.key_context>=64 ||
       !(keyboard_suppression()&(UINT64_C(1)<<state.key_context)))
        stock_advanced_key_original(address,settings,owner);
    state.key_context=previous;
}
uint32_t board_key_action(uintptr_t address,uint32_t action) {
    if(!state.initialized)return action;
    uint64_t blocked=keyboard_suppression();
    if(!blocked && !state.fn_tracking && (action<0xf100u || action>0xf103u))return action;
    uint8_t key=record_key(address);if(key>=64)return action;
    /* Leave scanner history intact, but do not dispatch a controller-only
     * source's packed Fn/media/mouse/macro action through the generic path. */
    if(blocked&(UINT64_C(1)<<key)) { state.fn_origin[key]=0;return 0; }
    uint8_t event=load8(address+9),origin=state.fn_origin[key];
    if(origin) {
        /* Resolve release against the Fn action that was actually pressed,
         * even if the active layer now assigns this same key another action.
         * Native Fn release consumes idle 0, unlike ordinary key-up 11. */
        if(!(load8(address+8)&1u) || event==11 || event==0) {
            store8(address+9,0);state.fn_origin[key]=0;
        }
        return 0xf100u+origin;
    }
    if(action>=0xf100u && action<=0xf103u) {
        if(keyboard_suppression()&(UINT64_C(1)<<key))return 0;
        if(event==1) {
            state.fn_tracking=true;
            if(action==0xf100u)clear(state.fn_origin,sizeof(state.fn_origin));
            else state.fn_origin[key]=(uint8_t)(action&3u);
        }
    }
    return action;
}
static void fn_reconcile(void) {
    if(!state.fn_tracking)return;
    uint8_t held=0;uint64_t blocked=keyboard_suppression();
    for(unsigned key=0;key<64;key++)if(state.fn_origin[key]) {
        if(!(load8(key_record(key)+8)&1u) || (blocked&(UINT64_C(1)<<key)))state.fn_origin[key]=0;
        else held|=(uint8_t)(1u<<state.fn_origin[key]);
    }
    uint8_t layer=load8(0x82b9d);
    if(layer<1 || layer>3 || !(held&(1u<<layer))) {
        layer=0;for(unsigned i=1;i<=3;i++)if(held&(1u<<i)){layer=(uint8_t)i;break;}
    }
    for(unsigned i=0;i<=3;i++)store8(0x82b9e + i,(held&(1u<<i))?1:0);
    store8(0x82b9d,layer);
    uint32_t flags=load32(STOCK_FLAGS);
    store32(STOCK_FLAGS,held?(flags|0x20u):(flags&~0x20u));
    state.fn_tracking=held!=0;
}
static void fn_transition(void) {
    uint8_t layer=(load32(STOCK_FLAGS)&0x20u)?load8(0x82b9d):0;
    if(layer!=state.fn_display_layer) {
        state.fn_display_layer=layer;
        /* Let the existing RGB task compose/send in its own DMA context. */
        store32(0x8d260,0);
    }
}
void board_key_process_hook(void) {
    state.key_context=GP_NONE;stock_key_process();state.key_context=GP_NONE;
    if(state.initialized){fn_reconcile();fn_transition();}
}
static void mapping_changed(void) {
    /* Reconcile once after every install, including a round trip through mixed
     * mode between scans. A normal press may have reached the ledger meanwhile. */
    state.previous_suppression=0;
    uint64_t mask=0;
    for(unsigned s=0;s<2;s++) {
        const struct gp_physical_axis *axes[2]={&state.mapping.stick[s].x,&state.mapping.stick[s].y};
        for(unsigned a=0;a<2;a++) {
            uint8_t n=axes[a]->negative.key,p=axes[a]->positive.key;
            if(n<64)mask|=UINT64_C(1)<<n;
            if(p<64)mask|=UINT64_C(1)<<p;
        }
        uint8_t key=state.mapping.trigger[s].key;if(key<64)mask|=UINT64_C(1)<<key;
    }
    for(unsigned i=0;i<GP_BUTTON_COUNT;i++)if(state.mapping.button[i]<64)mask|=UINT64_C(1)<<state.mapping.button[i];
    for(unsigned i=0;i<4;i++)if(state.mapping.dpad[i]<64)mask|=UINT64_C(1)<<state.mapping.dpad[i];
    state.bound_keys=mask;
}
static uint64_t keyboard_suppression(void) {
    /* Policy uses the installed mapping, even during sensor faults/USB ACK. */
    uint32_t saved=irq_lock();
    uint64_t blocked=state.usb_enabled && state.mapping.mode==GP_CONTROLLER_ONLY ? state.bound_keys : 0;
    irq_unlock(saved);return blocked;
}
static void keyboard_policy_update(void) {
    const uint64_t blocked=keyboard_suppression();
    if(blocked==state.previous_suppression)return;
    const uint64_t added=blocked&~state.previous_suppression;
    state.previous_suppression=blocked;
    if(!added)return;
    /* Native working ledger is usage/owner pairs; cached HID images, rings
     * and DMA-owned buffers are separate. Drain a newly suppressed source
     * once, regardless of its current layer/usage/event byte. */
    uint32_t saved=irq_lock();
    uint32_t count=load32(0x8d1fc);
    uint32_t remaining=keyboard_policy_compact(RAM(0x80608),count,added);
    if(remaining!=count) {
        store32(0x8d1fc,remaining);store8(0x8d1f4,1);
    }
    irq_unlock(saved);
    fn_reconcile();fn_transition();
}
static bool usb_start(void *user,uint8_t endpoint,const uint8_t *data,size_t length) {
    (void)user;return stock_write(0,endpoint,data,(uint32_t)length)==0;
}
static void read_maxima(uint16_t *maximums) {
    unsigned key=0;
    for(unsigned row=1;row<=5;row++)for(unsigned slot=0;slot<row_lengths[row-1];slot++,key++) {
        unsigned col=matrix_columns[row-1][slot];
        uint16_t maximum=load16(performance(row,col)+2u);
        maximums[key]=(maximum>=10 && maximum<=10000)?maximum:0;
    }
}
static bool install(void *user,const struct gp_physical_config *mapping,uint8_t transport,const uint8_t wire[208]) {
    (void)user;
    if(transport!=GP_CAP_XINPUT && mapping->mode!=GP_OFF)return false;
    if(!state.profile_valid||state.profile!=load8(0x82ba8)||state.usb_phase)return false;
    /* Save the native keymap once, preserving both independent trailers.
     * Install only after mapped flash readback confirms the complete record. */
    if(!save_profile(wire,mapping->revision,state.usb_preference_enabled,state.usb_revision))return false;
    uint32_t saved=irq_lock();state.mapping=*mapping;mapping_changed();
    reset_physical();irq_unlock(saved);
    return true;
}
static void arm_out(void) {
    if(xbox_active() && state.xusb.configured && !state.suspended && !state.out_armed) {
        state.out_armed=true;
        if(stock_read(0,XUSB_OUT,state.out,32)!=0)state.out_armed=false;
    }
}
static void in_complete(uint8_t bus,uint8_t endpoint,uint32_t count) {
    (void)bus;(void)count;ae64_xusb_in_complete(&state.xusb,endpoint);
}
static void out_complete(uint8_t bus,uint8_t endpoint,uint32_t count) {
    (void)bus;state.out_armed=false;
    if(count<=sizeof(state.out))ae64_xusb_out(&state.xusb,endpoint,state.out,count);
    arm_out();
}
static void event(uint8_t bus,uint8_t value) {
    /* Reset/disconnect arrive after the native core cancels/closes endpoints.
     * Suspend retains transfer ownership. Resume does not overwrite in-flight IN.
     */
    if(value==1 || value==4 || value==12) {
        state.suspended=false;state.out_armed=false;ae64_xusb_configured(&state.xusb,false);
        reset_physical();
    } else if(value==5) {
        state.suspended=true;reset_physical();
    } else if(value==6) {
        state.suspended=false;arm_out();
    } else if(value==7) {
        state.suspended=false;
        /* Replayed SET_CONFIGURATION does not prove old DMA was cancelled. */
        if(!state.xusb.configured && state.usb_enabled) {
            ae64_xusb_configured(&state.xusb,true);
            reset_physical();
        }
        arm_out();
    }
    if(state.original_event)state.original_event(bus,value);
}
static void make_configuration(uint8_t *bytes,uint8_t type) {
    /* Preserve the stock interval bytes adjusted by its settings callback. */
    copy(bytes,RAM(0x80318),91);
    bytes[1]=type;bytes[2]=state.usb_enabled?CONFIG_LENGTH:91;bytes[3]=0;bytes[4]=state.usb_enabled?4:3;
    if(state.usb_enabled)ae64_xusb_interface_descriptor(&usb_config,bytes+91);
    else clear(bytes+91,CONFIG_LENGTH-91);
}
const uint8_t *board_device_descriptor(uint8_t speed) { (void)speed;return state.device_descriptor; }
const uint8_t *board_configuration(uint8_t speed) {
    (void)speed;make_configuration(state.configuration,2);return state.configuration;
}
const uint8_t *board_other_speed(uint8_t speed) {
    (void)speed;make_configuration(state.other,7);return state.other;
}
int board_usb_initialize(uint8_t bus,uintptr_t base,void (*original_event)(uint8_t,uint8_t)) {
    clear(&state,sizeof(state));state.original_event=original_event;state.usb_base=base;
    state.key_context=GP_NONE;
    state.usb_preference_enabled=true;
    bool preference_found=false;
    for(uint8_t profile=0;profile<GP_STORAGE_PROFILES;profile++) {
        bool enabled;uint32_t revision;
        if(gp_usb_storage_read(RAM(gp_usb_storage_address(profile)),profile,&enabled,&revision)&&
           (!preference_found||(revision!=state.usb_revision&&(uint32_t)(revision-state.usb_revision)<UINT32_C(0x80000000)))) {
            state.usb_preference_enabled=enabled;state.usb_revision=revision;preference_found=true;
        }
    }
    state.usb_target=state.usb_preference_enabled;usb_persona(state.usb_target);
    /* 10000 is a temporary protocol-validation ceiling, not sensor calibration.
     * Scan frames use each native calibrated maximum; missing calibration is neutral.
     */
    for(unsigned i=0;i<64;i++)state.maximum[i]=10000;
    gp_load_current();
    fn_rgb_init(&fn_protocol,fn_read,fn_install,0,true);
    fn_protocol.main_per_profile=true;
    fn_load_current();main_rgb_load_current();
    const struct ae64_xusb_io io={usb_start,0,0,0};
    ae64_xusb_init(&state.xusb,&usb_config,&io);
    ae64_xusb_ms_string(&usb_config,state.os_string);
    state.endpoint_in=(struct stock_endpoint){XUSB_IN,in_complete};
    state.endpoint_out=(struct stock_endpoint){XUSB_OUT,out_complete};
    stock_add_interface(bus,&state.interface);
    stock_add_endpoint(bus,&state.endpoint_in);stock_add_endpoint(bus,&state.endpoint_out);
    state.initialized=true;
    return stock_usb_initialize(bus,base,event);
}
bool board_ep0_hook(uint8_t bus,const struct ae64_usb_setup *setup,uint8_t **data,uint32_t *length) {
    if(state.initialized && setup && data && length) {
        if(setup->request_type==0x80 && setup->request==6 && setup->value==0x03ee &&
           (setup->index==0 || setup->index==0x0409)) {
            *data=state.os_string;*length=setup->length<18?setup->length:18;return true;
        }
        if((setup->request_type & 0x60u)==0x40u && setup->request==MS_VENDOR) {
            if(setup->request_type==0xc0 && setup->value==0 && setup->index==4) {
                uint32_t size=state.usb_enabled?40:16;
                *data=state.compatible;*length=setup->length<size?setup->length:size;return true;
            }
            /* No unchecked indexing through the stock MS properties handler. */
            return false;
        }
    }
    return stock_ep0_original(bus,setup,data,length);
}
void board_scan_hook(void) {
    stock_scan();
    if(!state.initialized)return;
    if(state.profile!=load8(0x82ba8))gp_load_current();
    keyboard_policy_update();
    /* Empty/off/hidden controller mappings do not need a second sensor sweep. */
    uint32_t saved=irq_lock(),generation=state.physical_generation;
    if(!xbox_active() || state.mapping.mode==GP_OFF || !state.bound_keys) { irq_unlock(saved);return; }
    const uint64_t bound=state.bound_keys;
    struct gp_physical_config mapping=state.mapping;
    struct gp_physical_context next=state.physical;
    irq_unlock(saved);
    uint64_t valid=0,pressed=0;
    unsigned key=0;
    for(unsigned row=1;row<=5;row++)for(unsigned slot=0;slot<row_lengths[row-1];slot++,key++) {
        uint64_t bit=UINT64_C(1)<<key;
        if(!(bound&bit))continue;
        unsigned col=matrix_columns[row-1][slot];
        uintptr_t r=record(row,col),p=performance(row,col);
        uint16_t flags=load16(r),maximum=load16(p+2u);
        state.maximum[key]=(maximum>=10 && maximum<=10000)?maximum:0;
        state.travel[key]=load16(r+0x1a);
        if((flags&1u) && !(flags&8u) && load8(p+8)==1 && state.maximum[key])valid|=bit;
        if(load8(r+8)&1u)pressed|=bit;
    }
    struct gp_physical_frame frame={state.travel,state.maximum,valid,pressed,true,stock_tick()};
    /* USB interrupts may neutralize/reset the shared state. Evaluate a local
     * snapshot with interrupts enabled, then publish only if no reset occurred.
     * The mapping snapshot also isolates a concurrent vendor settings commit. */
    struct gp_report report;
    gp_physical_update_cached(&next,&mapping,&frame,&report);
#ifdef AE64_HOST_TEST
    board_test_evaluation_hook();
#endif
    saved=irq_lock();
    if(generation==state.physical_generation) { state.physical=next;state.report=report; }
    irq_unlock(saved);
}
void board_schedule_hook(void) {
    /* Native ring push 0x12962..0x129a8 has no full-queue rejection. Re-send
     * the active keyboard format at most every 50ms so a lost release can
     * recover without another keypress. Keep all cached unbound keys,
     * and leave consumer/mouse bits and DMA-owned packet storage untouched. */
    uint32_t now=stock_tick();
    if(state.initialized)fn_transition();
    if(state.initialized && !state.suspended && !state.usb_phase &&
       load8(NATIVE_USB_STATE)==3 && keyboard_suppression() &&
       (uint32_t)(now-state.last_keyboard_refresh)>=50) {
        bool boot=(load32(0x8d2d4)&0x100u)!=0;
        /* Only the selected format has current held keys. Native 0x54f8..
         * 0x5514 otherwise suppresses an identical NKRO retry against its
         * last queued image, even if that image never reached the host. */
        if(!boot)store8(0x8d200,0);
        store8(KEYBOARD_REPORT_FLAGS,load8(KEYBOARD_REPORT_FLAGS)|(boot?1u:2u));
        state.last_keyboard_refresh=now;
    }
    stock_schedule();
    if(!state.initialized)return;
    now=stock_tick();
    usb_switch_tick(now);
    uint32_t saved=irq_lock();
    gp_physical_watchdog(&state.physical,now,50,&state.report);
    if(xbox_active() && !state.suspended && (uint32_t)(now-state.last_submit)>=1)
        if(ae64_xusb_submit(&state.xusb,&state.report))state.last_submit=now;
    irq_unlock(saved);
}
void board_dispatch_hook(void) {
    if(state.initialized) {
        /* Vendor validation must not overwrite an input frame's maxima while
         * that frame is being evaluated with interrupts enabled. */
        read_maxima(state.vendor.max_travel_um);
        const uint8_t *request=RAM(GP+0x65c);
        /* Reject legacy Main writes on this build. Strip writes and all
         * native lighting reads remain available. */
        if(request[0]==0x05&&request[1]==0x04&&request[2]==0) {
            clear(state.reply,64);state.reply[0]=0x05;state.reply[1]=0x04;state.reply[2]=0xff;
            stock_vendor_reply(state.reply);return;
        }
        if(usb_switch_request(request,state.reply,stock_tick())) { stock_vendor_reply(state.reply);return; }
        if(state.usb_phase && request[0]==0x10 && (request[1]>=0x21 && request[1]<=0x35)) {
            clear(state.reply,64);copy(state.reply,request,8);state.reply[8]=GP_VENDOR_CONFLICT;
            stock_vendor_reply(state.reply);return;
        }
        if(fn_rgb_handle(&fn_protocol,request,state.reply,stock_tick())) {
            stock_vendor_reply(state.reply);return;
        }
        if(gp_vendor_handle(&state.vendor,request,state.reply,stock_tick())) {
            /* Native reply function copies into its persistent vendor-report queue. */
            stock_vendor_reply(state.reply);return;
        }
    }
    stock_dispatch_original();
}
void board_device_info(void) {
    /* Native 01:02 uses bytes 0–44 of its cleared 64-byte reply.
     * Keep the factory version and UID, then add a versioned tail marker. */
    static const uint8_t identity[]={'A','E','6','4',1,0,9,0,0};
    stock_device_info();
    copy(RAM(GP+0x61c+48),identity,sizeof(identity));
}
#ifdef AE64_HOST_TEST
const struct gp_report *board_test_report(void) { return &state.report; }
bool board_test_install(const uint8_t *wire) {
    struct gp_physical_config c;uint8_t t;read_maxima(state.maximum);
    if(!gp_wire_decode(wire,state.mapping.revision+1,state.maximum,&c,&t) || (t!=GP_CAP_XINPUT&&c.mode!=GP_OFF))return false;
    state.mapping=c;mapping_changed();reset_physical();return true;
}
#endif
