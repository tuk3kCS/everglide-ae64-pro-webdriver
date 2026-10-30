/* Original experimental AE64 Pro v0.1.0.0 patch. SPDX-License-Identifier: MIT
 * Stock addresses/layouts are static RE evidence, not hardware validation.
 */
#include "board_port.h"
#include "default_profile.h"
#include "fn_storage.h"
#include "gp_storage.h"

#define RECORD_BASE UINT32_C(0x82bb8)
#define PERFORMANCE_BASE UINT32_C(0x865cc)
#define STOCK_FLAGS UINT32_C(0x8d2d0)
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
static const struct ae64_xusb_config usb_config={3,XUSB_IN,XUSB_OUT,1,1,MS_VENDOR};

struct board_state {
    struct gp_vendor_context vendor;
    struct gp_physical_config mapping;
    struct gp_physical_context physical;
    struct ae64_xusb xusb;
    struct gp_report report;
    uint16_t travel[64], maximum[64];
    uint64_t suppressed_events;
    uint8_t scanner_event[64];
    struct stock_interface interface;
    struct stock_endpoint endpoint_in,endpoint_out;
    uint8_t configuration[CONFIG_LENGTH], other[CONFIG_LENGTH];
    uint8_t os_string[18],compatible[40];
    uint8_t device_descriptor[18];
    uint8_t reply[64];
    /* HPM endpoint storage remains live through asynchronous completion. */
    _Alignas(64) uint8_t out[64];
    uint32_t last_submit;
    uintptr_t usb_base;
    uint32_t usb_revision,usb_requested_at,usb_phase_at,usb_interrupt_mask;
    uint8_t usb_phase;
    uint8_t usb_native_status;
    uint8_t profile;
    bool profile_valid;
    bool usb_enabled,usb_target;
    bool initialized,suspended,out_armed;
    void (*original_event)(uint8_t,uint8_t);
};
static struct board_state state;
static struct fn_rgb_context fn_protocol;
static struct fn_storage fn_colors;
static bool fn_save_ok;
static void gp_load_current(void);
static void restore_scanner_events(void);
static bool install(void *,const struct gp_physical_config *,uint8_t,const uint8_t[208]);
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
static bool xbox_active(void) { return state.usb_enabled && state.usb_phase==0; }
static void usb_persona(bool enabled) {
    state.usb_enabled=enabled;
    /* Keep stock VID/PID/strings and distinguish Windows OS-descriptor caches. */
    copy(state.device_descriptor,RAM(0x80374),18);
    state.device_descriptor[12]=enabled?7:8;state.device_descriptor[13]=1;
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
            else if(state.usb_enabled!=(bool)q[14]) {
                state.usb_target=(bool)q[14];state.usb_revision++;state.usb_requested_at=now;state.usb_phase=1;
                gp_physical_reset(&state.physical);state.report=(struct gp_report){0};
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
void board_fn_load_hook(void) {
    restore_scanner_events();
    stock_fn_load_original();fn_load_current();
    if(state.initialized)gp_load_current();
}
void board_fn_save_hook(void) {
    if(state.initialized && state.profile!=load8(0x82ba8))gp_load_current();
    fn_ensure_current();stock_fn_save_original();fn_save_ok=false;
    if(fn_colors.loaded&&fn_colors.profile==load8(0x82ba8))
        fn_save_ok=fn_storage_append(&fn_colors,stock_flash_program,fn_image(fn_colors.profile));
    if(state.initialized && state.profile_valid && state.profile==load8(0x82ba8))
        fn_save_ok=fn_save_ok&&gp_storage_append(state.profile,state.vendor.active,true,state.vendor.revision,
            stock_flash_program,RAM(gp_storage_address(state.profile)));
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
    state.mapping=mapping;state.profile=profile;state.profile_valid=profile<4;
    gp_vendor_init(&state.vendor,wire,revision,GP_CAP_XINPUT|GP_CAP_USB_SWITCH|GP_CAP_PERSISTENT,ceiling,install,0);
    gp_physical_reset(&state.physical);state.report=(struct gp_report){0};
    irq_unlock(saved);
}
static bool fn_read(void *user,uint8_t profile,uint8_t layer,uint8_t *colors,bool *enabled,uint32_t *revision) {
    (void)user;
    return fn_storage_read_image(fn_image(profile),profile,layer,colors,enabled,revision);
}
static bool fn_install(void *user,uint8_t profile,uint8_t layer,const uint8_t *colors,bool enabled,uint32_t revision) {
    (void)user;
    /* The native save serializes the active keymap. Never change this index
     * merely to save another profile, which would overwrite its keymap. */
    if(profile!=load8(0x82ba8)||profile>=4||layer<1||layer>3)return false;
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
static void restore_scanner_events(void) {
    /* Native scan 0x5ece..0x6cd2 returns after the first changed event byte
     * (0x6bb6..0x6c0a). Leaving our keyboard-only zero in r+9 makes a held
     * key look changed on every pass, starving all later matrix positions.
     * Restore scan history only around stock_scan; stock_schedule still sees
     * the suppressed keyboard events. Never overwrite a newer native event
     * or import an old profile's event history into a newly loaded profile. */
    if(state.initialized && state.profile==load8(0x82ba8)) {
        unsigned key=0;
        for(unsigned row=1;row<=5;row++)for(unsigned col=0;col<row_lengths[row-1];col++,key++)
            if((state.suppressed_events&(UINT64_C(1)<<key)) && !load8(record(row,col)+9))
                store8(record(row,col)+9,state.scanner_event[key]);
    }
    state.suppressed_events=0;
}
static bool usb_start(void *user,uint8_t endpoint,const uint8_t *data,size_t length) {
    (void)user;return stock_write(0,endpoint,data,(uint32_t)length)==0;
}
static void refresh_maxima(void) {
    unsigned key=0;
    for(unsigned row=1;row<=5;row++)for(unsigned col=0;col<row_lengths[row-1];col++,key++) {
        uint16_t maximum=load16(performance(row,col)+2u);
        state.maximum[key]=(maximum>=10 && maximum<=10000)?maximum:0;
    }
}
static bool install(void *user,const struct gp_physical_config *mapping,uint8_t transport,const uint8_t wire[208]) {
    (void)user;
    if(transport!=GP_CAP_XINPUT && mapping->mode!=GP_OFF)return false;
    if(!state.profile_valid||state.profile!=load8(0x82ba8)||state.usb_phase)return false;
    /* Save the native keymap once, preserving both independent trailers.
     * Install only after mapped flash readback confirms the complete record. */
    fn_ensure_current();
    if(!fn_colors.loaded||fn_colors.profile!=state.profile)return false;
    stock_fn_save_original();
    if(!fn_storage_append(&fn_colors,stock_flash_program,fn_image(state.profile)) ||
       !gp_storage_append(state.profile,wire,true,mapping->revision,stock_flash_program,RAM(gp_storage_address(state.profile))))return false;
    uint32_t saved=irq_lock();state.mapping=*mapping;
    gp_physical_reset(&state.physical);
    state.report=(struct gp_report){0};irq_unlock(saved);
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
        gp_physical_reset(&state.physical);state.report=(struct gp_report){0};
    } else if(value==5) {
        state.suspended=true;gp_physical_reset(&state.physical);state.report=(struct gp_report){0};
    } else if(value==6) {
        state.suspended=false;arm_out();
    } else if(value==7) {
        state.suspended=false;
        /* Replayed SET_CONFIGURATION does not prove old DMA was cancelled. */
        if(!state.xusb.configured && state.usb_enabled) {
            ae64_xusb_configured(&state.xusb,true);
            gp_physical_reset(&state.physical);state.report=(struct gp_report){0};
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
    state.usb_target=true;usb_persona(true);
    /* 10000 is a temporary protocol-validation ceiling, not sensor calibration.
     * Scan frames use each native calibrated maximum; missing calibration is neutral.
     */
    for(unsigned i=0;i<64;i++)state.maximum[i]=10000;
    gp_load_current();
    fn_rgb_init(&fn_protocol,fn_read,fn_install,0,true);
    fn_load_current();
    const struct ae64_xusb_io io={usb_start,0,0,0};
    ae64_xusb_init(&state.xusb,&usb_config,&io);
    ae64_xusb_ms_string(&usb_config,state.os_string);
    ae64_xusb_ms_compatible_id(&usb_config,state.compatible);
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
    restore_scanner_events();
    stock_scan();
    if(!state.initialized)return;
    if(state.profile!=load8(0x82ba8))gp_load_current();
    uint64_t valid=0,pressed=0;
    unsigned key=0;refresh_maxima();
    uint64_t suppress=xbox_active()?gp_physical_keyboard_suppression(&state.mapping,state.maximum):0;
    for(unsigned row=1;row<=5;row++)for(unsigned col=0;col<row_lengths[row-1];col++,key++) {
        uintptr_t r=record(row,col),p=performance(row,col);
        uint16_t flags=load16(r);uint64_t bit=UINT64_C(1)<<key;
        state.travel[key]=load16(r+0x1a);
        if((flags & 1u) && !(flags & 8u) && load8(p+8)==1 && state.maximum[key])valid|=bit;
        /* Stock scanner's current normal/RT latch, before keyboard suppression.
         * Its low bits are shifted to previous-state bits by native 0x64e0..0x6572.
         */
        if(load8(r+8)&1u)pressed|=bit;
        if((suppress&bit) && load8(r+9)) {
            state.scanner_event[key]=load8(r+9);state.suppressed_events|=bit;
            store8(r+9,0);
            /* Request stock event processing, including releases already held. */
            store32(STOCK_FLAGS,load32(STOCK_FLAGS)|1u);
        }
    }
    struct gp_physical_frame frame={state.travel,state.maximum,valid,pressed,true,stock_tick()};
    uint32_t saved=irq_lock();
    if(xbox_active())gp_physical_update(&state.physical,&state.mapping,&frame,&state.report);
    else { gp_physical_reset(&state.physical);state.report=(struct gp_report){0}; }
    irq_unlock(saved);
}
void board_schedule_hook(void) {
    stock_schedule();
    if(!state.initialized)return;
    uint32_t now=stock_tick();
    usb_switch_tick(now);
    uint32_t saved=irq_lock();
    gp_physical_watchdog(&state.physical,now,50,&state.report);
    if(xbox_active() && !state.suspended && (uint32_t)(now-state.last_submit)>=1)
        if(ae64_xusb_submit(&state.xusb,&state.report))state.last_submit=now;
    irq_unlock(saved);
}
void board_dispatch_hook(void) {
    if(state.initialized) {
        refresh_maxima();
        for(unsigned i=0;i<64;i++)state.vendor.max_travel_um[i]=state.maximum[i];
        const uint8_t *request=RAM(GP+0x65c);
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
#ifdef AE64_HOST_TEST
const struct gp_report *board_test_report(void) { return &state.report; }
bool board_test_install(const uint8_t *wire) {
    struct gp_physical_config c;uint8_t t;refresh_maxima();
    if(!gp_wire_decode(wire,state.mapping.revision+1,state.maximum,&c,&t) || (t!=GP_CAP_XINPUT&&c.mode!=GP_OFF))return false;
    state.mapping=c;gp_physical_reset(&state.physical);state.report=(struct gp_report){0};return true;
}
#endif
