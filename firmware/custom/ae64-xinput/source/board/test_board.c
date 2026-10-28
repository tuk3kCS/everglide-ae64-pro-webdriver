/* Synthetic board/USB integration tests. No hardware access. SPDX-License-Identifier: MIT */
#include "board_port.h"
#include "default_profile.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static unsigned checks;
#define CHECK(x) do { checks++;if(!(x)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#x);exit(1);} }while(0)
static uint8_t ram[0x100000],last_packet[20],last_reply[64];
static uint32_t now;
static unsigned scan_count,schedule_count,dispatch_count,ep0_count,writes,reads,events;
static const struct stock_endpoint *ep_in,*ep_out;
static void (*event_callback)(uint8_t,uint8_t);
static bool fail_write;
static const uint8_t *owned;
static uint8_t profile_flash[4][0x2000];
static unsigned fn_renders,fn_saves;
static bool fail_flash;
void *test_stock_ram(uintptr_t a) {
    if(a>=0x800b2000u&&a<0x800c0000u) {
        unsigned profile=(unsigned)(a-0x800b2000u)/0x4000u,offset=(unsigned)(a-0x800b2000u)%0x4000u;
        CHECK(profile<4&&offset<0x2000u);return profile_flash[profile]+offset;
    }
    CHECK(a<sizeof(ram));return ram+a;
}
void stock_fn_render(void) {
    fn_renders++;for(unsigned i=0;i<360;i++)ram[0x8d084+i]=0x5a;
}
void stock_fn_load_original(void) {}
void stock_fn_save_original(void) {
    CHECK(ram[0x82ba8]<4);memset(profile_flash[ram[0x82ba8]],0xff,0x2000);fn_saves++;
    /* Native records occupy the exact prefix; the trailer must not change it. */
    memset(profile_flash[ram[0x82ba8]],0x69,0x16ac);
}
void stock_flash_program(uintptr_t address,uint32_t length,const uint8_t *data) {
    CHECK(!(address&3)&&!(length&3)&&!((uintptr_t)data&3));
    if(fail_flash)return;
    uint8_t *destination=test_stock_ram(address);for(unsigned i=0;i<length;i++)destination[i]&=data[i];
}
void stock_scan(void) { scan_count++; }
void stock_schedule(void) { schedule_count++; }
void stock_dispatch_original(void) { dispatch_count++; }
bool stock_ep0_original(uint8_t bus,const struct ae64_usb_setup *s,uint8_t **d,uint32_t *n) {
    (void)bus;(void)s;(void)d;(void)n;ep0_count++;return false;
}
void stock_add_interface(uint8_t b,struct stock_interface *i) { CHECK(b==0);i->number=3; }
void stock_add_endpoint(uint8_t b,const struct stock_endpoint *e) {
    CHECK(b==0);if(e->address==0x85)ep_in=e;else { CHECK(e->address==5);ep_out=e; }
}
int stock_usb_initialize(uint8_t b,uintptr_t base,void (*cb)(uint8_t,uint8_t)) {
    CHECK(b==0 && base==0xf300c000);event_callback=cb;return 0;
}
void stock_usb_event(uint8_t b,uint8_t e) { CHECK(b==0);(void)e;events++; }
int stock_write(uint8_t bus,uint8_t ep,const uint8_t *bytes,uint32_t n) {
    CHECK(bus==0 && ep==0x85 && n==20);if(fail_write)return -2;
    CHECK(owned==NULL);owned=bytes;memcpy(last_packet,bytes,20);writes++;return 0;
}
int stock_read(uint8_t bus,uint8_t ep,uint8_t *bytes,uint32_t n) {
    CHECK(bus==0 && ep==5 && bytes && n==32);reads++;return 0;
}
int stock_vendor_reply(const uint8_t *bytes) { memcpy(last_reply,bytes,64);return 1; }
uint32_t stock_tick(void) { return now; }
static void complete(void) { CHECK(ep_in!=NULL);owned=NULL;ep_in->callback(0,0x85,20); }
static void p16(unsigned address,unsigned v) { ram[address]=(uint8_t)v;ram[address+1]=(uint8_t)(v>>8); }
static unsigned rec(unsigned key) {
    const unsigned sizes[5]={14,14,13,14,9};unsigned row=1;
    while(key>=sizes[row-1])key-=sizes[row++-1];
    return 0x82bb8+row*0x5e8+key*0x48;
}
static unsigned perf(unsigned key) {
    const unsigned sizes[5]={14,14,13,14,9};unsigned row=1;
    while(key>=sizes[row-1])key-=sizes[row++-1];
    return 0x865cc+row*0xd2+key*10;
}
static void key(unsigned k,unsigned travel,bool down) {
    p16(rec(k)+0x1a,travel);ram[rec(k)+8]=down?1:0;ram[rec(k)+9]=down?1:0;
}
static void fixture(void) {
    memset(ram,0,sizeof(ram));owned=NULL;now=0;
    const uint8_t configuration[91]={
      9,2,91,0,3,1,0,0xa0,100,9,4,0,0,1,3,1,1,0,
      9,0x21,0x10,1,0,1,0x22,62,0,7,5,0x81,3,8,0,1,
      9,4,1,0,1,3,0,0,0,9,0x21,0x10,1,0,1,0x22,157,0,7,5,0x82,3,64,0,1,
      9,4,2,0,2,3,0,0,0,9,0x21,0x10,1,0,1,0x22,34,0,7,5,0x83,3,64,0,1,7,5,4,3,64,0,1
    };
    memcpy(ram+0x80318,configuration,91);
    for(unsigned k=0;k<64;k++){p16(rec(k),1);p16(perf(k)+2,4000);ram[perf(k)+8]=1;}
    CHECK(board_usb_initialize(0,0xf300c000,stock_usb_event)==0);
    CHECK(ep_in && ep_out && event_callback);
}
static void descriptors(void) {
    const uint8_t *c=board_configuration(1);CHECK(c[1]==2 && c[2]==131 && c[3]==0 && c[4]==4);
    unsigned interfaces=0,endpoints=0,p=0;bool seen[256]={false};
    while(p<131) {
        CHECK(c[p]>=2 && p+c[p]<=131);
        if(c[p+1]==4)interfaces++;
        if(c[p+1]==5){CHECK(!seen[c[p+2]]);seen[c[p+2]]=true;endpoints++;}
        p+=c[p];
    }
    CHECK(p==131 && interfaces==4 && endpoints==6);
    CHECK(c[91+5]==0xff && c[91+6]==0x5d && c[91+7]==1 && seen[0x85] && seen[5]);
    CHECK(board_other_speed(2)[1]==7);
    ram[0x80318+33]=4;CHECK(board_configuration(1)[33]==4);
    struct ae64_usb_setup s={0x80,6,0x03ee,0,255};uint8_t *d=NULL;uint32_t n=0;
    CHECK(board_ep0_hook(0,&s,&d,&n) && n==18 && d[2]=='M' && d[16]==0x20);
    s.length=4;CHECK(board_ep0_hook(0,&s,&d,&n) && n==4);
    s=(struct ae64_usb_setup){0xc0,0x20,0,4,255};
    CHECK(board_ep0_hook(0,&s,&d,&n) && n==40 && d[16]==3 && memcmp(d+18,"XUSB10",6)==0);
    s.value=0xffff;s.index=5;CHECK(!board_ep0_hook(0,&s,&d,&n));
    unsigned old=ep0_count;s=(struct ae64_usb_setup){0x80,6,0x0100,0,18};
    CHECK(!board_ep0_hook(0,&s,&d,&n) && ep0_count==old+1);
}
static void analog(void) {
    event_callback(0,7);CHECK(reads>0);
    board_scan_hook();board_scan_hook();
    key(15,3500,true);key(17,2000,true);key(29,3500,true);
    board_scan_hook();const struct gp_report *r=board_test_report();
    CHECK(r->lt==255 && r->rt==127 && r->lx==-32768 && r->ly==0);
    CHECK(ram[rec(15)+9]==0 && ram[rec(17)+9]==0 && ram[rec(29)+9]==0);
    CHECK((ram[0x8d2d0]&1)!=0);
    now=1;board_schedule_hook();CHECK(last_packet[1]==20 && last_packet[4]==255 && last_packet[5]==127);
    uint8_t saved[20];memcpy(saved,owned,20);unsigned count=writes;
    key(15,500,false);board_scan_hook();now=2;board_schedule_hook();
    CHECK(writes==count && memcmp(owned,saved,20)==0);complete();board_schedule_hook();CHECK(writes==count+1);complete();
    uint8_t wire[208];memcpy(wire,default_profile,208);
    // Q trigger full output at 3mm, zero at 1mm.
    wire[18]=0xe8;wire[19]=3;wire[20]=0xb8;wire[21]=0xb;
    CHECK(board_test_install(wire));for(unsigned k=0;k<64;k++)key(k,0,false);
    board_scan_hook();board_scan_hook();
    key(15,1000,true);board_scan_hook();CHECK(board_test_report()->lt==0);
    key(15,2000,true);board_scan_hook();CHECK(board_test_report()->lt==127);
    key(15,3000,true);board_scan_hook();CHECK(board_test_report()->lt==255);
    // Invalid calibration and watchdog both release output and require rearming.
    ram[perf(15)+8]=0;board_scan_hook();CHECK(board_test_report()->lt==0);
    ram[perf(15)+8]=1;board_scan_hook();CHECK(board_test_report()->lt==0);
    key(15,0,false);board_scan_hook();board_scan_hook();key(15,3000,true);board_scan_hook();CHECK(board_test_report()->lt==255);
    now+=51;board_schedule_hook();CHECK(board_test_report()->lt==0);complete();
    CHECK(scan_count>0 && schedule_count>0);
}
static void digital(void) {
    uint8_t wire[208];memcpy(wire,default_profile,208);
    for(unsigned slot=0;slot<24;slot++)wire[16+slot*8]=255;
    wire[16+10*8]=0; // Esc -> controller A.
    CHECK(board_test_install(wire));for(unsigned k=0;k<64;k++)key(k,0,false);
    board_scan_hook();board_scan_hook();
    key(0,100,true);board_scan_hook();CHECK(board_test_report()->buttons==1 && ram[rec(0)+9]==0);
    // Travel alone does not act as a separate digital actuation threshold.
    key(0,3500,false);board_scan_hook();CHECK(board_test_report()->buttons==0);
    wire[5]=2;CHECK(board_test_install(wire));key(0,0,false);board_scan_hook();board_scan_hook();
    key(0,100,true);board_scan_hook();CHECK(board_test_report()->buttons==1 && ram[rec(0)+9]==1);
    wire[5]=0;CHECK(board_test_install(wire));board_scan_hook();CHECK(board_test_report()->buttons==0);
    now++;fail_write=true;board_schedule_hook();fail_write=false;board_schedule_hook();complete();
    event_callback(0,5);unsigned count=writes;now++;board_schedule_hook();CHECK(writes==count);
    event_callback(0,6);board_schedule_hook();CHECK(writes==count+1);complete();
    event_callback(0,1);now++;board_schedule_hook();CHECK(writes==count+1);
}
static void protocol(void) {
    uint8_t *req=ram+0x80b00+0x65c;memset(req,0,64);req[0]=0x10;req[1]=0x20;req[2]=1;req[3]=42;memcpy(req+4,"AGP1",4);
    board_dispatch_hook();CHECK(last_reply[0]==0x10 && last_reply[1]==0x20 && last_reply[3]==42 && last_reply[8]==0);
    CHECK(last_reply[10]==0x0a && last_reply[14]==GP_CAP_XINPUT && !(last_reply[14]&GP_CAP_PERSISTENT));
    unsigned old=dispatch_count;req[0]=1;board_dispatch_hook();CHECK(dispatch_count==old+1);
}
int main(void) {
    fixture();descriptors();analog();digital();protocol();
    printf("PASS: synthetic board integration, %u checks; no hardware exercised.\n",checks);return 0;
}
