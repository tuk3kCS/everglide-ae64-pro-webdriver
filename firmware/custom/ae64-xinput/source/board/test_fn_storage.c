/* Offline tests: no keyboard or flash driver. SPDX-License-Identifier: MIT */
#include "fn_storage.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
static unsigned checks,calls,fail_call;
static _Alignas(4) uint8_t flash[FN_STORAGE_HEADER+FN_STORAGE_BYTES];
static uintptr_t expected;
#define CHECK(x) do { ++checks;if(!(x)){fprintf(stderr,"CHECK failed line %d: %s\n",__LINE__,#x);exit(1);} }while(0)
static void program(uintptr_t address,uint32_t length,const uint8_t *data) {
    ++calls;CHECK(!(address&3u));CHECK(!(length&3u));CHECK(!((uintptr_t)data&3u));
    CHECK(address>=expected&&address+length<=expected+sizeof(flash));
    if(calls==fail_call)return;
    for(unsigned i=0;i<length;i++)flash[address-expected+i]&=data[i];
}
int main(void) {
    struct fn_storage source,decoded;
    uint8_t colors[FN_RGB_BYTES];bool enabled;uint32_t revision;
    CHECK(sizeof(struct fn_storage)==1144);
    CHECK(fn_storage_address(4)==0);
    for(unsigned profile=0;profile<4;profile++) {
        fn_storage_clear(&source,(uint8_t)profile);source.revision=123456+profile;
        source.data[FN_STORAGE_COLORS]=5;
        for(unsigned i=0;i<FN_STORAGE_COLORS;i++)source.data[i]=(uint8_t)(i*13+profile);
        expected=UINT32_C(0x800b3700)+profile*0x4000;
        CHECK(fn_storage_address((uint8_t)profile)==expected);
        memset(flash,255,sizeof(flash));calls=0;fail_call=0;
        CHECK(fn_storage_append(&source,program,flash));CHECK(calls==2);
        CHECK(fn_storage_decode(&decoded,(uint8_t)profile,flash));
        CHECK(!memcmp(source.data,decoded.data,FN_STORAGE_BYTES));CHECK(source.revision==decoded.revision);
        for(unsigned layer=1;layer<=3;layer++) {
            CHECK(fn_storage_read_image(flash,(uint8_t)profile,(uint8_t)layer,colors,&enabled,&revision));
            CHECK(!memcmp(colors,source.data+(layer-1)*FN_RGB_BYTES,FN_RGB_BYTES));
            CHECK(enabled==(layer!=2));CHECK(revision==source.revision);
        }
        CHECK(!fn_storage_decode(&decoded,(uint8_t)((profile+1)%4),flash));CHECK(decoded.revision==0);
        for(unsigned i=0;i<sizeof(flash);i++)for(unsigned bit=0;bit<8;bit++) {
            flash[i]^=(uint8_t)(1u<<bit);
            CHECK(!fn_storage_decode(&decoded,(uint8_t)profile,flash));
            flash[i]^=(uint8_t)(1u<<bit);
        }
        for(fail_call=1;fail_call<=2;fail_call++) {
            memset(flash,255,sizeof(flash));calls=0;
            CHECK(!fn_storage_append(&source,program,flash));
            CHECK(!fn_storage_decode(&decoded,(uint8_t)profile,flash));
            CHECK(fn_storage_read_image(flash,(uint8_t)profile,1,colors,&enabled,&revision));
            CHECK(!enabled&&!revision);
            for(unsigned i=0;i<FN_RGB_BYTES;i++)CHECK(colors[i]==0);
        }
    }
    CHECK(!fn_storage_read_image(flash,0,0,colors,&enabled,&revision));
    CHECK(!fn_storage_read_image(flash,4,1,colors,&enabled,&revision));
    printf("%u Fn storage checks passed\n",checks);return 0;
}
