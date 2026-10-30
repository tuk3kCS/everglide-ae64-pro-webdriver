/* Corruption/failure/bounds tests with synthetic flash only. SPDX-License-Identifier: MIT */
#include "gp_storage.h"
#include "default_profile.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks,calls,fail_call,partial_call,active_profile;
static _Alignas(4) uint8_t flash[GP_STORAGE_PROFILES][0x2000],neighbors[GP_STORAGE_PROFILES][0x2000];
static uintptr_t expected;
#define CHECK(x) do { checks++;if(!(x)){fprintf(stderr,"FAIL gp storage:%d: %s\n",__LINE__,#x);exit(1);} }while(0)
static uint8_t *image(void) { return flash[active_profile]+GP_STORAGE_OFFSET; }
static void program(uintptr_t address,uint32_t length,const uint8_t *data) {
    calls++;CHECK(!(address&3u)&&!(length&3u)&&!((uintptr_t)data&3u));
    CHECK(address>=expected&&address+length<=expected+GP_STORAGE_BYTES);
    CHECK((calls==1&&address==expected+GP_STORAGE_HEADER&&length==GP_WIRE_BYTES)||
          (calls==2&&address==expected&&length==GP_STORAGE_HEADER));
    if(calls==fail_call)return;
    if(calls==partial_call)length/=2;
    for(unsigned i=0;i<length;i++)image()[address-expected+i]&=data[i];
}
static void erase_fixture(unsigned profile) {
    active_profile=profile;expected=UINT32_C(0x800b3c00)+(uintptr_t)profile*0x4000u;
    memset(flash,0x69,sizeof(flash));
    for(unsigned p=0;p<GP_STORAGE_PROFILES;p++)memset(flash[p]+0x1700,0x33,0x480);
    memset(image(),0xff,GP_STORAGE_BYTES);memcpy(neighbors,flash,sizeof(flash));
    calls=fail_call=partial_call=0;
}
static void unchanged_neighbors(void) {
    for(unsigned p=0;p<GP_STORAGE_PROFILES;p++)for(unsigned i=0;i<0x2000;i++)
        if(p!=active_profile||i<GP_STORAGE_OFFSET||i>=GP_STORAGE_OFFSET+GP_STORAGE_BYTES)
            CHECK(flash[p][i]==neighbors[p][i]);
}
static void seal(uint8_t *bytes) {
    uint8_t crc_input[16+GP_WIRE_BYTES];memcpy(crc_input,bytes,16);memcpy(crc_input+16,bytes+GP_STORAGE_HEADER,GP_WIRE_BYTES);
    uint32_t crc=gp_crc32(crc_input,sizeof(crc_input));for(unsigned i=0;i<4;i++)bytes[16+i]=(uint8_t)(crc>>(8*i));
}
int main(void) {
    _Alignas(4) uint8_t wire[GP_WIRE_BYTES],restored[GP_WIRE_BYTES],valid_image[GP_STORAGE_BYTES];bool enabled;uint32_t revision;
    CHECK(GP_STORAGE_BYTES==240);CHECK(gp_storage_address(4)==0);CHECK(gp_storage_address(255)==0);
    for(unsigned profile=0;profile<GP_STORAGE_PROFILES;profile++)for(unsigned power=0;power<2;power++) {
        erase_fixture(profile);memcpy(wire,default_profile,GP_WIRE_BYTES);wire[16]=(uint8_t)(40+profile);
        CHECK(gp_storage_address((uint8_t)profile)==expected);
        CHECK(gp_storage_append((uint8_t)profile,wire,power!=0,123456u+profile,program,image()));CHECK(calls==2);
        unchanged_neighbors();
        enabled=power==0;revision=0;
        CHECK(gp_storage_read(image(),(uint8_t)profile,restored,&enabled,&revision));
        CHECK(!memcmp(wire,restored,GP_WIRE_BYTES));CHECK(enabled==(power!=0)&&revision==123456u+profile);
        CHECK(!gp_storage_read(image(),(uint8_t)((profile+1u)%4u),restored,&enabled,&revision));
        memcpy(valid_image,image(),GP_STORAGE_BYTES);
        for(unsigned byte=0;byte<GP_STORAGE_BYTES;byte++)for(unsigned bit=0;bit<8;bit++) {
            image()[byte]^=(uint8_t)(1u<<bit);
            memset(restored,0xa7,sizeof(restored));enabled=true;revision=0xcafebabeu;
            CHECK(!gp_storage_read(image(),(uint8_t)profile,restored,&enabled,&revision));
            CHECK(restored[0]==0xa7&&restored[GP_WIRE_BYTES-1]==0xa7&&enabled&&revision==0xcafebabeu);
            image()[byte]^=(uint8_t)(1u<<bit);
        }
        CHECK(gp_storage_read(image(),(uint8_t)profile,restored,&enabled,&revision));
        /* Correct CRC does not bless malformed version/flags/reserved/wire data. */
        const unsigned fields[]={4,5,6,7,8,9,10,11,20,31,32,36,37,38,39,41,46,48,49,51,53,55};
        const uint8_t values[]={2,4,2,1,0,1,1,1,1,1,'X',2,3,3,255,1,23,64,2,255,0,0};
        for(unsigned i=0;i<sizeof(fields)/sizeof(fields[0]);i++) {
            memcpy(image(),valid_image,GP_STORAGE_BYTES);image()[fields[i]]=values[i];seal(image());
            CHECK(!gp_storage_read(image(),(uint8_t)profile,restored,&enabled,&revision));
        }
        /* A duplicate physical assignment is invalid even with a valid CRC. */
        memcpy(image(),valid_image,GP_STORAGE_BYTES);image()[GP_STORAGE_HEADER+24]=image()[GP_STORAGE_HEADER+16];seal(image());
        CHECK(!gp_storage_read(image(),(uint8_t)profile,restored,&enabled,&revision));
        for(unsigned failure=1;failure<=2;failure++) {
            erase_fixture(profile);fail_call=failure;
            CHECK(!gp_storage_append((uint8_t)profile,wire,true,UINT32_MAX,program,image()));
            CHECK(calls==failure);CHECK(!gp_storage_read(image(),(uint8_t)profile,restored,&enabled,&revision));unchanged_neighbors();
            erase_fixture(profile);partial_call=failure;
            CHECK(!gp_storage_append((uint8_t)profile,wire,true,0,program,image()));
            CHECK(calls==failure);CHECK(!gp_storage_read(image(),(uint8_t)profile,restored,&enabled,&revision));unchanged_neighbors();
        }
    }
    erase_fixture(0);memcpy(wire,default_profile,GP_WIRE_BYTES);
    CHECK(!gp_storage_append(4,wire,true,1,program,image()));CHECK(calls==0);
    CHECK(!gp_storage_append(0,NULL,true,1,program,image()));CHECK(calls==0);
    CHECK(!gp_storage_append(0,wire,true,1,NULL,image()));CHECK(calls==0);
    CHECK(!gp_storage_append(0,wire,true,1,program,NULL));CHECK(calls==0);
    wire[4]=2;CHECK(!gp_storage_append(0,wire,true,1,program,image()));CHECK(calls==0);
    CHECK(!gp_storage_read(NULL,0,restored,&enabled,&revision));
    CHECK(!gp_storage_read(image(),0,NULL,&enabled,&revision));
    CHECK(!gp_storage_read(image(),0,restored,NULL,&revision));
    CHECK(!gp_storage_read(image(),0,restored,&enabled,NULL));
    printf("PASS: %u persistent gamepad checks; all 4 profiles, enabled/disabled, every trailer bit, valid-CRC malformed fields, partial/failed programs, alignment and native/Fn/neighbor preservation.\n",checks);
    return 0;
}
