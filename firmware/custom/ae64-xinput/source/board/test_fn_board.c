/* Native rendering/save/load integration with synthetic RAM/flash only. */
#define main base_board_tests
#include "test_board.c"
#undef main
#include "fn_storage.h"
static void put32(uint8_t *p,uint32_t v) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i)); }
static unsigned fn_command(uint8_t cmd,const uint8_t *p,unsigned n) {
    uint8_t *q=ram+0x8115c;memset(q,0,64);q[0]=0x10;q[1]=cmd;q[2]=1;q[3]=42;memcpy(q+4,"FNR1",4);q[9]=(uint8_t)n;if(n)memcpy(q+10,p,n);board_dispatch_hook();return last_reply[8];
}
static unsigned upload_fn(uint8_t profile,uint8_t layer,const uint8_t *colors,uint32_t revision,bool enable) {
    uint8_t begin[20]={profile,layer,(uint8_t)enable,0},token[8]={1,2,3,4,5,6,7,8};put32(begin+4,revision);put32(begin+8,gp_crc32(colors,FN_RGB_BYTES));memcpy(begin+12,token,8);
    unsigned status=fn_command(0x31,begin,20);if(status)return status;
    for(unsigned offset=0;offset<FN_RGB_BYTES;offset+=44) {
        unsigned n=FN_RGB_BYTES-offset;if(n>44)n=44;uint8_t p[54];memcpy(p,token,8);p[8]=(uint8_t)offset;p[9]=(uint8_t)(offset>>8);memcpy(p+10,colors+offset,n);CHECK(fn_command(0x32,p,n+10)==0);
    }
    status=fn_command(0x33,token,8);if(status)CHECK(fn_command(0x34,token,8)==0);return status;
}
static uint32_t word(unsigned address) { uint32_t value;memcpy(&value,ram+address,4);return value; }
int main(void) {
    base_board_tests();memset(profile_flash,0xff,sizeof(profile_flash));uint8_t colors[FN_RGB_BYTES];
    memset(ram+0x8cc4c,0xa7,360);memset(ram+0x8d084-4,0x73,4);memset(ram+0x8d084+360,0x74,4);
    for(unsigned profile=0;profile<4;profile++) {
        ram[0x82ba8]=(uint8_t)profile;board_fn_load_hook();
        for(unsigned layer=1;layer<=3;layer++) {
            for(unsigned i=0;i<FN_RGB_BYTES;i++)colors[i]=(uint8_t)(i+profile*17+layer*31);
            CHECK(upload_fn((uint8_t)profile,(uint8_t)layer,colors,layer-1,true)==0);
            ram[0x82b9d]=(uint8_t)layer;put32(ram+0x8d2d0,0x20);unsigned before=fn_renders;board_fn_render_hook();CHECK(fn_renders==before+1);
            for(unsigned row=0;row<6;row++)for(unsigned col=0;col<15;col++) {
                unsigned i=(row*21+col)*3;CHECK(word(0x8d084+(row*15+col)*4)==(0xff000000u|(uint32_t)colors[i]<<16|(uint32_t)colors[i+1]<<8|colors[i+2]));
            }
            CHECK(word(0x8d084-4)==0x73737373u&&word(0x8d084+360)==0x74747474u);
            CHECK(word(0x8cc4c)==0xa7a7a7a7u);
            board_fn_save_hook();board_fn_load_hook();board_fn_render_hook();CHECK(word(0x8d084)!=(uint32_t)0x5a5a5a5a);
            CHECK(profile_flash[profile][0x16ab]==0x69&&profile_flash[profile][0x16ac]==0xff);
        }
        CHECK(upload_fn((uint8_t)((profile+1)%4),1,colors,profile==3?3:0,true)==GP_VENDOR_STORAGE);
    }
    CHECK(fn_saves==24);
    put32(ram+0x8d2d0,0);board_fn_render_hook();CHECK(word(0x8d084)==0x5a5a5a5au);
    put32(ram+0x8d2d0,0x20);ram[0x82b9d]=0;board_fn_render_hook();CHECK(word(0x8d084)==0x5a5a5a5au);
    ram[0x82b9d]=3;CHECK(upload_fn(3,3,colors,3,false)==0);board_fn_render_hook();CHECK(word(0x8d084)==0x5a5a5a5au);
    ram[0x82ba8]=4;board_fn_render_hook();CHECK(word(0x8d084)==0x5a5a5a5au);ram[0x82ba8]=3;board_fn_load_hook();
    fail_flash=true;CHECK(upload_fn(3,3,colors,4,true)==GP_VENDOR_STORAGE);fail_flash=false;board_fn_render_hook();CHECK(word(0x8d084)==0x5a5a5a5au);
    printf("PASS: %u Fn board checks; native fallback, ARGB frames, profile isolation, save/load persistence and failed writes.\n",checks);return 0;
}
