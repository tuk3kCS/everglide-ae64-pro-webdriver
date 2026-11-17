/* Synthetic flash and vendor transactions for per-profile Main lighting. */
#define main base_board_tests
#include "test_board.c"
#undef main
#include "fn_storage.h"
#include "gp_storage.h"

static void put32(uint8_t *p,uint32_t value) {
    for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(value>>(8*i));
}
static unsigned command(uint8_t cmd,const uint8_t *p,unsigned bytes) {
    uint8_t *q=ram+0x8115c;
    memset(q,0,64);q[0]=0x10;q[1]=cmd;q[2]=1;q[3]=10;
    memcpy(q+4,"FNR1",4);q[9]=(uint8_t)bytes;memcpy(q+10,p,bytes);
    board_dispatch_hook();return last_reply[8];
}
static unsigned upload(uint8_t profile,const uint8_t *matrix,uint32_t revision) {
    uint8_t begin[20]={profile,0,1,0},token[8]={1,2,3,4,5,6,7,8};
    put32(begin+4,revision);put32(begin+8,gp_crc32(matrix,MAIN_RGB_BYTES));memcpy(begin+12,token,8);
    unsigned status=command(0x31,begin,sizeof(begin));
    if(status)return status;
    for(unsigned offset=0;offset<MAIN_RGB_BYTES;offset+=44) {
        unsigned bytes=MAIN_RGB_BYTES-offset;if(bytes>44)bytes=44;
        uint8_t payload[54];memcpy(payload,token,8);payload[8]=(uint8_t)offset;payload[9]=(uint8_t)(offset>>8);
        memcpy(payload+10,matrix+offset,bytes);
        CHECK(command(0x32,payload,10+bytes)==GP_VENDOR_OK);
    }
    status=command(0x33,token,sizeof(token));
    if(status)CHECK(command(0x34,token,sizeof(token))==GP_VENDOR_OK);
    return status;
}
static void select_profile(uint8_t profile) {
    ram[0x82ba8]=profile;
    board_fn_load_hook();
}
int main(void) {
    base_board_tests();
    memset(profile_flash,0xff,sizeof(profile_flash));
    uint8_t inherited[MAIN_RGB_BYTES]={11,22,33,255},profiles[4][MAIN_RGB_BYTES]={{0}};
    put32(shared_rgb_flash,0x20250508u);put32(shared_rgb_flash+4,0x20260929u);
    memcpy(shared_rgb_flash+0x200,inherited,sizeof(inherited));
    ram[0x8cf1b]=0x5a;ram[0x8d084]=0x6a;
    for(uint8_t profile=0;profile<4;profile++) {
        select_profile(profile);
        CHECK(memcmp(ram+0x8cf1c,inherited,sizeof(inherited))==0);
        const uint8_t selector[]={profile,0};
        CHECK(command(0x30,selector,2)==GP_VENDOR_OK);
        CHECK(last_reply[17]==15&&last_reply[18]==7&&last_reply[20]==profile);
        board_fn_save_hook();
        uint8_t old_trailers[0x610];
        memcpy(old_trailers,profile_flash[profile]+0x1700,sizeof(old_trailers));
        unsigned index=(profile+1u)*4u;
        profiles[profile][index]=(uint8_t)(7u+profile);
        profiles[profile][index+3]=255;
        CHECK(upload(profile,profiles[profile],0)==GP_VENDOR_OK);
        CHECK(memcmp(old_trailers,profile_flash[profile]+0x1700,sizeof(old_trailers))==0);
        CHECK(memcmp(ram+0x8cf1c,profiles[profile],MAIN_RGB_BYTES)==0);
        CHECK(ram[0x8cf1b]==0x5a&&ram[0x8d084]==0x6a);
        uint32_t revision=0;uint8_t readback[MAIN_RGB_BYTES];
        CHECK(main_rgb_read(profile_flash[profile]+MAIN_RGB_OFFSET,profile,readback,&revision));
        CHECK(revision==1&&memcmp(readback,profiles[profile],MAIN_RGB_BYTES)==0);
        const unsigned before=fn_saves;
        CHECK(upload(profile,profiles[profile],0)==GP_VENDOR_CONFLICT&&fn_saves==before);
    }
    for(uint8_t profile=0;profile<4;profile++) {
        select_profile(profile);board_fn_save_hook();select_profile(profile);
        CHECK(memcmp(ram+0x8cf1c,profiles[profile],MAIN_RGB_BYTES)==0);
    }
    ram[0x8cb1c]=0x75;board_rgb_save_shared();
    CHECK(shared_rgb_flash[0x400]==0x75);
    CHECK(memcmp(shared_rgb_flash+0x200,inherited,MAIN_RGB_BYTES)==0);
    CHECK(memcmp(ram+0x8cf1c,profiles[3],MAIN_RGB_BYTES)==0);
    const unsigned before=fn_saves;
    CHECK(upload(2,profiles[2],1)==GP_VENDOR_STORAGE&&fn_saves==before);
    profiles[3][3]=1;
    CHECK(upload(3,profiles[3],1)==GP_VENDOR_STORAGE&&fn_saves==before);
    memset(profiles[3],0,MAIN_RGB_BYTES);
    CHECK(upload(3,profiles[3],1)==GP_VENDOR_OK);
    board_fn_load_hook();
    CHECK(memcmp(ram+0x8cf1c,profiles[3],MAIN_RGB_BYTES)==0);
    memset(ram+0x8115c,0,64);ram[0x8115c]=5;ram[0x8115d]=4;
    board_dispatch_hook();CHECK(last_reply[0]==5&&last_reply[1]==4&&last_reply[2]==255);
    profile_flash[2][MAIN_RGB_OFFSET+12]^=1;
    select_profile(2);CHECK(memcmp(ram+0x8cf1c,inherited,MAIN_RGB_BYTES)==0);
    select_profile(1);CHECK(memcmp(ram+0x8cf1c,profiles[1],MAIN_RGB_BYTES)==0);
    printf("PASS: %u Main RGB board checks, 4 slots, migration, read-back, stale/wrong-profile/invalid write rejection, native and strip saves, clears, and corrupt-record fallback.\n",checks);
    return 0;
}
