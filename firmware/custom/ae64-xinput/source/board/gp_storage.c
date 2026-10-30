/* Native 8KB keymap-tail codec; no USB or erase operations. SPDX-License-Identifier: MIT */
#include "gp_storage.h"

_Static_assert(GP_STORAGE_BYTES==240,"Gamepad trailer size");
_Static_assert(GP_STORAGE_OFFSET>=0x1700u+16u+1136u,"Fn trailer overlap");
_Static_assert(GP_STORAGE_OFFSET>=8u+0x16a4u,"Native keymap overlap");
_Static_assert(GP_STORAGE_OFFSET+GP_STORAGE_BYTES<=0x2000u,"Native allocation boundary");
_Static_assert(!(GP_STORAGE_HEADER%4u)&&!(GP_WIRE_BYTES%4u),"Native program word alignment");

static uint16_t u16(const uint8_t *p) { return (uint16_t)(p[0]|(uint16_t)p[1]<<8); }
static uint32_t u32(const uint8_t *p) { return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24; }
static void p32(uint8_t *p,uint32_t value) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(value>>(i*8)); }
static void copy(uint8_t *dst,const uint8_t *src,unsigned length) { while(length--)*dst++=*src++; }
static bool same(const uint8_t *a,const uint8_t *b,unsigned length) { uint8_t different=0;while(length--)different|=*a++^*b++;return different==0; }

uintptr_t gp_storage_address(uint8_t profile) {
    return profile<GP_STORAGE_PROFILES?UINT32_C(0x800b2000)+(uintptr_t)profile*0x4000u+GP_STORAGE_OFFSET:0;
}
static uint32_t checksum(const uint8_t *header,const uint8_t *wire) {
    uint32_t crc=UINT32_MAX;
    for(unsigned i=0;i<16u+GP_WIRE_BYTES;i++) {
        crc^=i<16u?header[i]:wire[i-16u];
        for(unsigned bit=0;bit<8;bit++)crc=(crc>>1)^((0u-(crc&1u))&UINT32_C(0xedb88320));
    }
    return ~crc;
}
static bool wire_valid(const uint8_t *wire,uint32_t revision) {
    uint16_t maximum[GP_KEY_COUNT];
    for(unsigned i=0;i<GP_KEY_COUNT;i++)maximum[i]=GP_PHYSICAL_MAX_STROKE_UM;
    struct gp_physical_config mapping;uint8_t transport;
    return wire&&gp_wire_decode(wire,revision,maximum,&mapping,&transport);
}
static bool valid(const uint8_t *image,uint8_t profile) {
    if(!image||profile>=GP_STORAGE_PROFILES||!same(image,(const uint8_t *)"GPR1",4))return false;
    if(image[4]!=1||image[5]!=profile||(image[6]&~1u)||image[7]||u16(image+8)!=GP_WIRE_BYTES||u16(image+10))return false;
    for(unsigned i=20;i<GP_STORAGE_HEADER;i++)if(image[i])return false;
    if(u32(image+16)!=checksum(image,image+GP_STORAGE_HEADER))return false;
    return wire_valid(image+GP_STORAGE_HEADER,u32(image+12));
}
bool gp_storage_read(const uint8_t *image,uint8_t profile,uint8_t wire[GP_WIRE_BYTES],bool *usb_enabled,uint32_t *revision) {
    if(!wire||!usb_enabled||!revision||!valid(image,profile))return false;
    copy(wire,image+GP_STORAGE_HEADER,GP_WIRE_BYTES);
    *usb_enabled=(image[6]&1u)!=0;*revision=u32(image+12);return true;
}
bool gp_storage_append(uint8_t profile,const uint8_t wire[GP_WIRE_BYTES],bool usb_enabled,uint32_t revision,
                       gp_storage_program_fn program,const uint8_t *mapped) {
    uintptr_t address=gp_storage_address(profile);
    if(!address||!program||!mapped||!wire_valid(wire,revision))return false;
    _Alignas(4) uint8_t header[GP_STORAGE_HEADER]={ 'G','P','R','1',1,0,0,0,GP_WIRE_BYTES&255u,GP_WIRE_BYTES>>8,0,0 };
    _Alignas(4) uint8_t payload[GP_WIRE_BYTES];
    copy(payload,wire,GP_WIRE_BYTES);header[5]=profile;header[6]=usb_enabled?1u:0u;
    p32(header+12,revision);p32(header+16,checksum(header,payload));
    program(address+GP_STORAGE_HEADER,GP_WIRE_BYTES,payload);
    if(!same(mapped+GP_STORAGE_HEADER,payload,GP_WIRE_BYTES))return false;
    program(address,GP_STORAGE_HEADER,header);
    return same(mapped,header,GP_STORAGE_HEADER)&&valid(mapped,profile);
}
