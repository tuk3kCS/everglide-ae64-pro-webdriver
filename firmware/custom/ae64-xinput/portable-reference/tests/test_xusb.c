/* Original offline tests. SPDX-License-Identifier: MIT */
#include "ae64_xusb.h"
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <string.h>

struct fake_usb {
    bool accept;
    unsigned starts, rumble_calls, led_calls;
    uint8_t endpoint, large, small, led;
    const uint8_t *pointer;
    uint8_t copied[20];
    size_t length;
};
static bool start(void *user, uint8_t ep, const uint8_t *p, size_t n) {
    struct fake_usb *f=user; f->starts++; f->endpoint=ep; f->pointer=p; f->length=n;
    assert(n==20); memcpy(f->copied,p,n); return f->accept;
}
static void rumble(void *user,uint8_t a,uint8_t b) {
    struct fake_usb *f=user; f->rumble_calls++; f->large=a; f->small=b;
}
static void led(void *user,uint8_t n) { struct fake_usb *f=user; f->led_calls++; f->led=n; }

int main(void) {
    const struct ae64_xusb_config config={3,0x85,5,4,4,0x20};
    struct fake_usb fake={0};
    struct ae64_xusb_io io={start,rumble,led,&fake};
    struct ae64_xusb x;
    assert(ae64_xusb_init(&x,&config,&io));
    assert(!ae64_xusb_init(NULL,&config,&io));
    struct ae64_xusb_config invalid=config; invalid.endpoint_in=5;
    assert(!ae64_xusb_config_valid(&invalid));
    invalid=config; invalid.endpoint_out=0x85; assert(!ae64_xusb_config_valid(&invalid));
    invalid=config; invalid.endpoint_out=0; assert(!ae64_xusb_config_valid(&invalid));
    invalid=config; invalid.interval_in=0; assert(!ae64_xusb_config_valid(&invalid));
    invalid=config; invalid.interval_out=17; assert(!ae64_xusb_config_valid(&invalid));
    invalid=config; invalid.ms_vendor_code=0; assert(!ae64_xusb_config_valid(&invalid));

    uint8_t descriptor[40], dev[18];
    assert(ae64_xusb_interface_descriptor(&config,descriptor));
    assert(descriptor[0]==9 && descriptor[1]==4 && descriptor[2]==3);
    assert(descriptor[4]==2 && descriptor[5]==0xFF && descriptor[6]==0x5D && descriptor[7]==1);
    assert(descriptor[9]==17 && descriptor[15]==0x85 && descriptor[22]==5);
    assert(descriptor[26]==7 && descriptor[28]==0x85 && descriptor[30]==32 && descriptor[32]==4);
    assert(descriptor[33]==7 && descriptor[35]==5 && descriptor[37]==32 && descriptor[39]==4);
    unsigned off=0; while(off<40) { assert(descriptor[off]>1); off+=descriptor[off]; } assert(off==40);
    ae64_xusb_device_descriptor(dev);
    assert(dev[8]==0xA6 && dev[9]==0x1C && dev[10]==0x0A && dev[11]==0x30);
    assert(ae64_xusb_ms_compatible_id(&config,descriptor));
    assert(descriptor[0]==40 && descriptor[6]==4 && descriptor[8]==1);
    assert(descriptor[16]==3 && descriptor[17]==1 && !memcmp(descriptor+18,"XUSB10",6));
    for(unsigned i=26;i<40;i++) assert(descriptor[i]==0);

    uint8_t reply[64]; size_t length=999;
    struct ae64_usb_setup setup={0x80,6,0x03EE,0,255};
    assert(ae64_xusb_control(&x,&setup,reply,sizeof(reply),&length) && length==18);
    assert(reply[0]==18 && reply[1]==3 && reply[2]=='M' && reply[14]=='0' && reply[16]==0x20);
    setup.length=2; assert(ae64_xusb_control(&x,&setup,reply,sizeof(reply),&length) && length==2);
    setup.length=0; assert(ae64_xusb_control(&x,&setup,NULL,0,&length) && length==0);
    setup=(struct ae64_usb_setup){0xC0,0x20,0,4,65535};
    assert(ae64_xusb_control(&x,&setup,reply,sizeof(reply),&length) && length==40);
    assert(reply[16]==3 && !memcmp(reply+18,"XUSB10",6));
    memset(reply,0xCC,sizeof(reply));
    assert(!ae64_xusb_control(&x,&setup,reply,39,&length) && length==0 && reply[0]==0xCC);
    setup.request_type=0xC1; assert(!ae64_xusb_control(&x,&setup,reply,64,&length));
    setup.request_type=0xC0; setup.request=0x21; assert(!ae64_xusb_control(&x,&setup,reply,64,&length));
    setup.request=0x20; setup.value=1; assert(!ae64_xusb_control(&x,&setup,reply,64,&length));
    setup.value=0; setup.index=5; assert(!ae64_xusb_control(&x,&setup,reply,64,&length));

    struct gp_report state={0};
    state.lx=-32768; state.ly=32767; state.rx=-1; state.ry=0x1234;
    state.lt=0x12; state.rt=0x34; state.buttons=(1u<<GP_A)|(1u<<GP_R3); state.dpad=1u<<GP_UP;
    const uint8_t golden[20]={0,20,0x81,0x10,0x12,0x34,0,0x80,0xFF,0x7F,0xFF,0xFF,0x34,0x12,0,0,0,0,0,0};
    uint8_t packet[20]; ae64_xusb_encode_input(&state,packet); assert(!memcmp(packet,golden,20));
    ae64_xusb_encode_input(NULL,packet); assert(packet[1]==20);
    for(unsigned i=0;i<20;i++) if(i!=1) assert(packet[i]==0);

    assert(!ae64_xusb_submit(&x,&state));
    ae64_xusb_configured(&x,true);
    fake.accept=true; assert(ae64_xusb_submit(&x,&state));
    assert(x.in_flight && fake.endpoint==0x85 && fake.pointer==x.tx && fake.length==20);
    uint8_t preserved[20]; memcpy(preserved,x.tx,20);
    state.lt=0x99; assert(!ae64_xusb_submit(&x,&state)); assert(!memcmp(x.tx,preserved,20));
    ae64_xusb_in_complete(&x,0x84); assert(x.in_flight);
    ae64_xusb_in_complete(&x,0x85); assert(!x.in_flight);
    fake.accept=false; assert(!ae64_xusb_submit(&x,&state) && !x.in_flight);
    fake.accept=true; assert(ae64_xusb_submit(&x,&state));
    ae64_xusb_in_complete(&x,0x85);

    const uint8_t rumble_packet[8]={0,8,0,0x55,0xAA,0,0,0};
    const uint8_t led_packet[3]={1,3,6};
    assert(ae64_xusb_out(&x,5,rumble_packet,8));
    assert(fake.rumble_calls==1 && fake.large==0x55 && fake.small==0xAA);
    assert(ae64_xusb_out(&x,5,led_packet,3) && fake.led_calls==1 && fake.led==6);
    assert(!ae64_xusb_out(&x,4,rumble_packet,8));
    for(size_t n=0;n<8;n++) assert(!ae64_xusb_out(&x,5,rumble_packet,n));
    uint8_t malformed[9]={0,9,0,1,2,0,0,0,0}; assert(!ae64_xusb_out(&x,5,malformed,9));
    malformed[1]=8; malformed[2]=1; assert(!ae64_xusb_out(&x,5,malformed,8));
    ae64_xusb_configured(&x,false); assert(!ae64_xusb_out(&x,5,led_packet,3));
    puts("XUSB offline backend: descriptors, control bounds, input packet, transfer lifetime and OUT parsing passed");
    return 0;
}
