/* Persistent mappings, reboot and native/Fn coexistence; synthetic flash only. */
#define main base_board_tests
#include "test_board.c"
#undef main
#include "gp_storage.h"
#include "fn_storage.h"
static void put32(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(i*8));}
static unsigned command(uint8_t code,const uint8_t *data,unsigned length) {
    uint8_t *q=ram+0x8115c;memset(q,0,64);q[0]=0x10;q[1]=code;q[2]=1;q[3]=77;memcpy(q+4,"AGP1",4);q[9]=(uint8_t)length;
    if(length)memcpy(q+10,data,length);board_dispatch_hook();return last_reply[8];
}
static uint32_t revision(void){CHECK(command(0x20,NULL,0)==0);return (uint32_t)last_reply[18]|(uint32_t)last_reply[19]<<8|(uint32_t)last_reply[20]<<16|(uint32_t)last_reply[21]<<24;}
static unsigned upload(const uint8_t *wire) {
    const uint8_t token[8]={8,7,6,5,4,3,2,1};uint32_t rev=revision(),crc=gp_crc32(wire,208);
    uint8_t begin[18]={0};put32(begin,rev);put32(begin+4,crc);begin[8]=208;memcpy(begin+10,token,8);CHECK(command(0x21,begin,18)==0);
    for(unsigned offset=0;offset<208;offset+=40){uint8_t data[50];unsigned count=208-offset;if(count>40)count=40;memcpy(data,token,8);data[8]=(uint8_t)offset;data[9]=(uint8_t)(offset>>8);memcpy(data+10,wire+offset,count);CHECK(command(0x22,data,count+10)==0);}
    uint8_t commit[16];memcpy(commit,token,8);put32(commit+8,crc);put32(commit+12,rev);unsigned result=command(0x23,commit,16);if(result)CHECK(command(0x24,token,8)==0);else CHECK(last_reply[14]==1);return result;
}
static void read_wire(uint8_t *wire) {
    uint32_t rev=revision();for(unsigned offset=0;offset<208;offset+=48){uint8_t p[7];unsigned count=208-offset;if(count>48)count=48;put32(p,rev);p[4]=(uint8_t)offset;p[5]=(uint8_t)(offset>>8);p[6]=(uint8_t)count;CHECK(command(0x25,p,7)==0);memcpy(wire+offset,last_reply+16,count);}
}
static void cold_boot(void) {
    owned=NULL;CHECK(board_usb_initialize(0,0xf300c000,stock_usb_event)==0);event_callback(0,1);event_callback(0,7);
}
int main(void) {
    fixture();memset(profile_flash,0xff,sizeof(profile_flash));ram[0x82ba8]=0;cold_boot();uint8_t actual[208],wire[208];read_wire(actual);
    CHECK(memcmp(actual,default_profile,208)==0);for(unsigned i=0;i<24;i++)CHECK(actual[16+i*8]==255);
    for(unsigned k=0;k<64;k++)p16(perf(k)+2,3310);
    /* Legacy example is rejected, not silently made into a saved user profile. */
    CHECK(upload(example_profile)==GP_VENDOR_CONFIG);
    memcpy(wire,default_profile,208);wire[16]=15;wire[18]=0xe8;wire[19]=3;wire[20]=0xb8;wire[21]=0x0b;wire[22]=0xee;wire[23]=0x0c;
    CHECK(upload(wire)==GP_VENDOR_OK);read_wire(actual);CHECK(memcmp(actual,wire,208)==0);
    CHECK(profile_flash[0][0x16ab]==0x69&&profile_flash[0][0x16ac]==0xff);
    CHECK(memcmp(profile_flash[0]+FN_STORAGE_OFFSET,"FNR1",4)==0&&memcmp(profile_flash[0]+GP_STORAGE_OFFSET,"GPR1",4)==0);
    cold_boot();read_wire(actual);CHECK(memcmp(actual,wire,208)==0);
    for(unsigned k=0;k<64;k++)key(k,0,false);board_scan_hook();board_scan_hook();key(15,3000,true);board_scan_hook();CHECK(board_test_report()->lt==255);
    now++;board_schedule_hook();CHECK(last_packet[4]==255);
    /* Repeated configuration must not clear an active IN buffer or rearm OUT. */
    uint8_t packet[20];memcpy(packet,owned,20);unsigned before=reads;event_callback(0,7);CHECK(reads==before&&memcmp(packet,owned,20)==0);now++;board_schedule_hook();CHECK(memcmp(packet,owned,20)==0);complete();
    /* Native/Fn keymap saves preserve gamepad bytes. */
    board_fn_save_hook();cold_boot();read_wire(actual);CHECK(memcmp(actual,wire,208)==0);
    /* Per-onboard-profile isolation; switching back restores the saved mapping. */
    ram[0x82ba8]=1;board_fn_load_hook();read_wire(actual);CHECK(memcmp(actual,default_profile,208)==0);
    uint8_t other[208];memcpy(other,default_profile,208);other[16+10*8]=0;CHECK(upload(other)==0);
    ram[0x82ba8]=0;board_fn_load_hook();read_wire(actual);CHECK(memcmp(actual,wire,208)==0);
    /* Flash failure is never a successful commit and keeps active RAM mapping. */
    fail_flash=true;CHECK(upload(other)==GP_VENDOR_STORAGE);fail_flash=false;read_wire(actual);CHECK(memcmp(actual,wire,208)==0);
    cold_boot();read_wire(actual);CHECK(memcmp(actual,default_profile,208)==0);
    /* Corrupted/missing saved record stays empty, never returns six examples. */
    CHECK(upload(wire)==0);profile_flash[0][GP_STORAGE_OFFSET+32]^=1;cold_boot();read_wire(actual);CHECK(memcmp(actual,default_profile,208)==0);
    printf("PASS: %u persistent board checks; real commit/readback, cold reboot, 3.31mm output, replay ownership, Fn/native saves, profile isolation and failed/corrupt records.\n",checks);return 0;
}
