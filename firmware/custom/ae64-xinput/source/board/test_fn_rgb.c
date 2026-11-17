/* Protocol regression tests; no device access. SPDX-License-Identifier: MIT */
#include "ae64_fn_rgb.h"
#include "ae64_gamepad_protocol.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static unsigned checks,writes;static uint8_t db[4][3][FN_RGB_BYTES];static bool enabled[4][3];
#define CHECK(x) do { checks++;if(!(x)){fprintf(stderr,"FAIL %d: %s\n",__LINE__,#x);exit(1);} }while(0)
static uint32_t revision(unsigned p,unsigned l) { return gp_crc32(db[p][l],FN_RGB_BYTES)^(enabled[p][l]?0xa514c9e3u:0); }
static bool read_profile(void *u,uint8_t p,uint8_t l,uint8_t *out,bool *e,uint32_t *r) {
    (void)u;CHECK(p<4&&l>=1&&l<=3);memcpy(out,db[p][l-1],FN_RGB_BYTES);*e=enabled[p][l-1];*r=revision(p,l-1);return true;
}
static bool install(void *u,uint8_t p,uint8_t l,const uint8_t *data,bool e,uint32_t r) {
    (void)u;if(revision(p,l-1)!=r)return false;memcpy(db[p][l-1],data,FN_RGB_BYTES);enabled[p][l-1]=e;writes++;return true;
}
static void p32(uint8_t *p,uint32_t v) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(i*8)); }
static uint8_t request[64],reply[64];static struct fn_rgb_context context;static uint32_t now;
static unsigned command(unsigned cmd,const uint8_t *p,unsigned n) {
    memset(request,0,64);request[0]=0x10;request[1]=(uint8_t)cmd;request[2]=1;request[3]=19;memcpy(request+4,"FNR1",4);request[9]=(uint8_t)n;if(n)memcpy(request+10,p,n);
    CHECK(fn_rgb_handle(&context,request,reply,now));CHECK(memcmp(reply,request,8)==0);return reply[8];
}
static void begin(unsigned p,unsigned l,bool e,const uint8_t *colors,uint8_t token[8]) {
    uint8_t b[20]={0};b[0]=(uint8_t)p;b[1]=(uint8_t)l;b[2]=e;p32(b+4,revision(p,l-1));p32(b+8,gp_crc32(colors,FN_RGB_BYTES));memcpy(b+12,token,8);CHECK(command(0x31,b,20)==0);
}
int main(void) {
    fn_rgb_init(&context,read_profile,install,NULL,true);uint8_t select[2]={0,1},token[8]={1,2,3,4,5,6,7,8},colors[FN_RGB_BYTES];
    CHECK(command(0x30,select,2)==0&&reply[9]==20&&reply[18]==3);CHECK(writes==0);
    for(unsigned profile=0;profile<4;profile++)for(unsigned layer=1;layer<=3;layer++) {
        for(unsigned i=0;i<FN_RGB_BYTES;i++)colors[i]=(uint8_t)(i+profile*37+layer*13);
        begin(profile,layer,true,colors,token);CHECK(command(0x33,token,8)==GP_VENDOR_INCOMPLETE);
        for(unsigned offset=0;offset<FN_RGB_BYTES;offset+=44) {
            unsigned n=FN_RGB_BYTES-offset;if(n>44)n=44;uint8_t p[54];memcpy(p,token,8);p[8]=(uint8_t)offset;p[9]=(uint8_t)(offset>>8);memcpy(p+10,colors+offset,n);
            CHECK(command(0x32,p,n+10)==0);CHECK(command(0x32,p,n+10)==0);
            p[10]^=1;CHECK(command(0x32,p,n+10)==GP_VENDOR_CONFLICT);
        }
        CHECK(command(0x33,token,8)==0);CHECK(memcmp(db[profile][layer-1],colors,FN_RGB_BYTES)==0);CHECK(enabled[profile][layer-1]);
        for(unsigned offset=0;offset<FN_RGB_BYTES;offset+=48) {
            uint8_t p[9]={(uint8_t)profile,(uint8_t)layer};p32(p+2,revision(profile,layer-1));p[6]=(uint8_t)offset;p[7]=(uint8_t)(offset>>8);unsigned n=FN_RGB_BYTES-offset;if(n>48)n=48;p[8]=(uint8_t)n;
            CHECK(command(0x35,p,9)==0);CHECK(reply[9]==n+6);CHECK(memcmp(reply+16,colors+offset,n)==0);
        }
    }
    CHECK(writes==12);begin(0,1,false,colors,token);now=5001;CHECK(command(0x33,token,8)==GP_VENDOR_CONFLICT);CHECK(writes==12);
    select[0]=4;CHECK(command(0x30,select,2)==GP_VENDOR_FORMAT);select[0]=0;select[1]=0;CHECK(command(0x30,select,2)==GP_VENDOR_FORMAT);
    for(unsigned n=0;n<64;n++) { memset(request,0,64);request[0]=0x10;request[1]=0x31;request[2]=1;memcpy(request+4,"FNR1",4);request[9]=(uint8_t)n;CHECK(fn_rgb_handle(&context,request,reply,now));CHECK(reply[8]!=0); }
    request[1]=0x20;CHECK(!fn_rgb_handle(&context,request,reply,now));
    printf("PASS: %u Fn RGB protocol checks; 12 isolated profiles and malformed transfers.\n",checks);return 0;
}
