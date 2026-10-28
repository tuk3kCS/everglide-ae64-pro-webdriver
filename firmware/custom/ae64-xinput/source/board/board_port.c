/* Original experimental AE64 Pro v0.1.0.0 patch. SPDX-License-Identifier: MIT
 * Stock addresses/layouts are static RE evidence, not hardware validation.
 */
#include "board_port.h"
#include "default_profile.h"

#define RECORD_BASE UINT32_C(0x82bb8)
#define PERFORMANCE_BASE UINT32_C(0x865cc)
#define STOCK_FLAGS UINT32_C(0x8d2d0)
#define GP UINT32_C(0x80b00)
#define XUSB_IN 0x85u
#define XUSB_OUT 0x05u
#define MS_VENDOR 0x20u
#define CONFIG_LENGTH 131u
static const uint8_t row_lengths[5]={14,14,13,14,9};
static const struct ae64_xusb_config usb_config={3,XUSB_IN,XUSB_OUT,1,1,MS_VENDOR};

struct board_state {
    struct gp_vendor_context vendor;
    struct gp_physical_config mapping;
    struct gp_physical_context physical;
    struct ae64_xusb xusb;
    struct gp_report report;
    uint16_t travel[64], maximum[64];
    struct stock_interface interface;
    struct stock_endpoint endpoint_in,endpoint_out;
    uint8_t configuration[CONFIG_LENGTH], other[CONFIG_LENGTH];
    uint8_t os_string[18],compatible[40];
    uint8_t reply[64];
    /* HPM endpoint storage remains live through asynchronous completion. */
    _Alignas(64) uint8_t out[64];
    uint32_t last_submit;
    bool initialized,suspended,out_armed;
    void (*original_event)(uint8_t,uint8_t);
};
static struct board_state state;
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
static uintptr_t record(unsigned row,unsigned column) { return RECORD_BASE+row*0x5e8u+column*0x48u; }
static uintptr_t performance(unsigned row,unsigned column) { return PERFORMANCE_BASE+row*0xd2u+column*10u; }
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
    (void)user;(void)wire;
    if(transport!=GP_CAP_XINPUT && mapping->mode!=GP_OFF)return false;
    uint32_t saved=irq_lock();state.mapping=*mapping;
    gp_physical_reset(&state.physical);
    state.report=(struct gp_report){0};irq_unlock(saved);
    return true;
}
static void arm_out(void) {
    if(state.xusb.configured && !state.suspended && !state.out_armed) {
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
        state.suspended=false;state.out_armed=false;ae64_xusb_configured(&state.xusb,true);
        gp_physical_reset(&state.physical);state.report=(struct gp_report){0};arm_out();
    }
    if(state.original_event)state.original_event(bus,value);
}
static void make_configuration(uint8_t *bytes,uint8_t type) {
    /* Preserve the stock interval bytes adjusted by its settings callback. */
    copy(bytes,RAM(0x80318),91);
    bytes[1]=type;bytes[2]=CONFIG_LENGTH;bytes[3]=0;bytes[4]=4;
    ae64_xusb_interface_descriptor(&usb_config,bytes+91);
}
const uint8_t *board_configuration(uint8_t speed) {
    (void)speed;make_configuration(state.configuration,2);return state.configuration;
}
const uint8_t *board_other_speed(uint8_t speed) {
    (void)speed;make_configuration(state.other,7);return state.other;
}
int board_usb_initialize(uint8_t bus,uintptr_t base,void (*original_event)(uint8_t,uint8_t)) {
    clear(&state,sizeof(state));state.original_event=original_event;
    /* 10000 is a temporary protocol-validation ceiling, not sensor calibration.
     * Scan frames use each native calibrated maximum; missing calibration is neutral.
     */
    for(unsigned i=0;i<64;i++)state.maximum[i]=10000;
    uint8_t transport=0;
    gp_wire_decode(default_profile,1,state.maximum,&state.mapping,&transport);
    gp_physical_reset(&state.physical);
    gp_vendor_init(&state.vendor,default_profile,1,GP_CAP_XINPUT,state.maximum,install,0);
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
                *data=state.compatible;*length=setup->length<40?setup->length:40;return true;
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
    uint64_t valid=0,pressed=0;
    unsigned key=0;refresh_maxima();
    uint64_t suppress=gp_physical_keyboard_suppression(&state.mapping,state.maximum);
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
            store8(r+9,0);
            /* Request stock event processing, including releases already held. */
            store32(STOCK_FLAGS,load32(STOCK_FLAGS)|1u);
        }
    }
    struct gp_physical_frame frame={state.travel,state.maximum,valid,pressed,true,stock_tick()};
    uint32_t saved=irq_lock();
    gp_physical_update(&state.physical,&state.mapping,&frame,&state.report);
    irq_unlock(saved);
}
void board_schedule_hook(void) {
    stock_schedule();
    if(!state.initialized)return;
    uint32_t now=stock_tick();
    uint32_t saved=irq_lock();
    gp_physical_watchdog(&state.physical,now,50,&state.report);
    if(!state.suspended && (uint32_t)(now-state.last_submit)>=1)
        if(ae64_xusb_submit(&state.xusb,&state.report))state.last_submit=now;
    irq_unlock(saved);
}
void board_dispatch_hook(void) {
    if(state.initialized) {
        refresh_maxima();
        for(unsigned i=0;i<64;i++)state.vendor.max_travel_um[i]=state.maximum[i];
        const uint8_t *request=RAM(GP+0x65c);
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
    return gp_wire_decode(wire,state.mapping.revision+1,state.maximum,&c,&t) && install(0,&c,t,wire);
}
#endif
