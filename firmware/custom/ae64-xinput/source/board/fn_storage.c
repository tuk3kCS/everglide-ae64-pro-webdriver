/* Stock v0.1.0.0 per-profile keymap-tail extension. SPDX-License-Identifier: MIT */
#include "fn_storage.h"
_Static_assert(FN_STORAGE_COLORS+2==FN_STORAGE_BYTES,"Trailer payload size");
_Static_assert(FN_STORAGE_OFFSET+FN_STORAGE_HEADER+FN_STORAGE_BYTES<=0x2000,"Native pair boundary");
_Static_assert(FN_STORAGE_OFFSET>=8+0x16a4,"Native keymap payload boundary");
static uint32_t u32(const uint8_t *p) {
    return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;
}
static void p32(uint8_t *p,uint32_t v) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i)); }
static void copy(uint8_t *d,const uint8_t *s,unsigned n) { while(n--)*d++=*s++; }
static bool same(const uint8_t *a,const uint8_t *b,unsigned n) {
    uint8_t difference=0;while(n--)difference|=*a++^*b++;return difference==0;
}
uintptr_t fn_storage_address(uint8_t profile) {
    return profile<FN_RGB_PROFILES?UINT32_C(0x800b2000)+(uintptr_t)profile*0x4000u+FN_STORAGE_OFFSET:0;
}
void fn_storage_clear(struct fn_storage *s,uint8_t profile) {
    *s=(struct fn_storage){0};s->profile=profile;s->loaded=profile<FN_RGB_PROFILES;
}
static uint32_t checksum(const uint8_t *header,const uint8_t *data) {
    uint32_t crc=UINT32_MAX;
    for(unsigned i=0;i<12+FN_STORAGE_BYTES;i++) {
        crc^=i<12?header[i]:data[i-12];
        for(unsigned bit=0;bit<8;bit++)crc=(crc>>1)^((0u-(crc&1u))&UINT32_C(0xedb88320));
    }
    return ~crc;
}
static bool valid(const uint8_t *p,uint8_t profile) {
    if(!p||profile>=FN_RGB_PROFILES||!same(p,(const uint8_t *)"FNR1",4))return false;
    if(p[4]!=1||p[5]!=profile||p[6]!=(uint8_t)FN_STORAGE_BYTES||p[7]!=(uint8_t)(FN_STORAGE_BYTES>>8))return false;
    if(p[16+FN_STORAGE_COLORS]&0xf8u||p[17+FN_STORAGE_COLORS])return false;
    return u32(p+12)==checksum(p,p+16);
}
bool fn_storage_decode(struct fn_storage *s,uint8_t profile,const uint8_t *image) {
    fn_storage_clear(s,profile);
    if(!valid(image,profile))return false;
    copy(s->data,image+16,FN_STORAGE_BYTES);s->revision=u32(image+8);return true;
}
bool fn_storage_read_image(const uint8_t *image,uint8_t profile,uint8_t layer,
                          uint8_t *colors,bool *enabled,uint32_t *revision) {
    if(profile>=FN_RGB_PROFILES||layer<1||layer>FN_RGB_LAYERS||!colors||!enabled||!revision)return false;
    *enabled=false;*revision=0;
    for(unsigned i=0;i<FN_RGB_BYTES;i++)colors[i]=0;
    if(valid(image,profile)) {
        copy(colors,image+16+(layer-1u)*FN_RGB_BYTES,FN_RGB_BYTES);
        *enabled=(image[16+FN_STORAGE_COLORS]&(1u<<(layer-1u)))!=0;*revision=u32(image+8);
    }
    return true;
}
bool fn_storage_append(const struct fn_storage *s,fn_storage_program_fn program,const uint8_t *mapped) {
    uintptr_t address=fn_storage_address(s->profile);
    if(!s->loaded||!address||!program||!mapped||(s->data[FN_STORAGE_COLORS]&0xf8u)||s->data[FN_STORAGE_COLORS+1])return false;
    _Alignas(4) uint8_t header[FN_STORAGE_HEADER]={ 'F','N','R','1',1,0,0,0,0,0,0,0,0,0,0,0 };
    header[5]=s->profile;header[6]=(uint8_t)FN_STORAGE_BYTES;header[7]=(uint8_t)(FN_STORAGE_BYTES>>8);
    p32(header+8,s->revision);p32(header+12,checksum(header,s->data));
    /* These exact lengths are word aligned: the stock API rounds to words. */
    program(address+16,FN_STORAGE_BYTES,s->data);
    if(!same(mapped+16,s->data,FN_STORAGE_BYTES))return false;
    program(address,FN_STORAGE_HEADER,header);
    return same(mapped,header,FN_STORAGE_HEADER)&&valid(mapped,s->profile);
}
