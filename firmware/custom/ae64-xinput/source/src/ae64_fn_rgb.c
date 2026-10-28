/* Separate FNR1 capability and transactional protocol. SPDX-License-Identifier: MIT */
#include "ae64_fn_rgb.h"
#include "ae64_gamepad_protocol.h"
static uint16_t u16(const uint8_t *p) { return (uint16_t)(p[0]|(uint16_t)p[1]<<8); }
static uint32_t u32(const uint8_t *p) { return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24; }
static void put32(uint8_t *p,uint32_t v) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i)); }
static void copy(uint8_t *d,const uint8_t *s,size_t n) { while(n--)*d++=*s++; }
static bool same(const uint8_t *a,const uint8_t *b,unsigned n) { uint8_t x=0;while(n--)x|=*a++^*b++;return x==0; }
static bool selector(uint8_t p,uint8_t l) { return p<FN_RGB_PROFILES&&l>=1&&l<=FN_RGB_LAYERS; }
void fn_rgb_init(struct fn_rgb_context *c,fn_rgb_read_fn read,fn_rgb_install_fn install,void *user,bool persistent) {
    *c=(struct fn_rgb_context){0};c->read=read;c->install=install;c->user=user;c->persistent=persistent;
}
static uint8_t process(struct fn_rgb_context *c,uint8_t cmd,const uint8_t *p,unsigned n,uint8_t *out,uint8_t *length,uint32_t now) {
    if(!c->read)return GP_VENDOR_BACKEND;
    if(c->active&&(uint32_t)(now-c->last_activity)>5000)c->active=false;
    uint8_t colors[FN_RGB_BYTES];bool enabled;uint32_t revision;
    if(cmd==0x30||cmd==0x35) {
        if((cmd==0x30&&n!=2)||(cmd==0x35&&n!=9)||!selector(p[0],p[1]))return GP_VENDOR_FORMAT;
        if(!c->read(c->user,p[0],p[1],colors,&enabled,&revision))return GP_VENDOR_STORAGE;
        if(cmd==0x30) {
            put32(out,0x0030000a);out[4]=4;out[5]=3;out[6]=6;out[7]=21;
            out[8]=(uint8_t)(2u|(c->persistent?1u:0u));out[9]=enabled;out[10]=p[0];out[11]=p[1];
            put32(out+12,revision);put32(out+16,gp_crc32(colors,FN_RGB_BYTES));*length=20;
        } else {
            unsigned offset=u16(p+6),count=p[8];
            if(!count||count>48||offset+count>FN_RGB_BYTES)return GP_VENDOR_FORMAT;
            if(u32(p+2)!=revision)return GP_VENDOR_CONFLICT;
            put32(out,revision);out[4]=(uint8_t)offset;out[5]=(uint8_t)(offset>>8);
            copy(out+6,colors+offset,count);*length=(uint8_t)(6+count);
        }
        return GP_VENDOR_OK;
    }
    if(cmd==0x34) {
        if(n!=8)return GP_VENDOR_FORMAT;
        if(c->active&&!same(p,c->token,8))return GP_VENDOR_CONFLICT;
        c->active=false;return GP_VENDOR_OK;
    }
    if(!c->install)return GP_VENDOR_BACKEND;
    if(cmd==0x31) {
        if(n!=20||!selector(p[0],p[1])||p[2]>1||p[3])return GP_VENDOR_FORMAT;
        uint8_t nonzero=0;for(unsigned i=12;i<20;i++)nonzero|=p[i];if(!nonzero)return GP_VENDOR_FORMAT;
        if(!c->read(c->user,p[0],p[1],colors,&enabled,&revision))return GP_VENDOR_STORAGE;
        if(u32(p+4)!=revision)return GP_VENDOR_CONFLICT;
        if(c->active)return GP_VENDOR_CONFLICT;
        c->profile=p[0];c->layer=p[1];c->enabled=p[2]!=0;c->revision=revision;c->checksum=u32(p+8);
        copy(c->token,p+12,8);for(unsigned i=0;i<sizeof(c->received);i++)c->received[i]=0;
        c->active=true;c->last_activity=now;return GP_VENDOR_OK;
    }
    if(cmd==0x32) {
        if(n<11||n>54)return GP_VENDOR_FORMAT;
        unsigned offset=u16(p+8),count=n-10;
        if(offset+count>FN_RGB_BYTES)return GP_VENDOR_FORMAT;
        if(!c->active||!same(p,c->token,8))return GP_VENDOR_CONFLICT;
        for(unsigned i=0;i<count;i++) {
            unsigned x=offset+i;
            /* Conflicting retransmits fail; exact duplicate chunks are safe. */
            if((c->received[x/8]&(1u<<(x%8)))&&c->staging[x]!=p[10+i])return GP_VENDOR_CONFLICT;
        }
        copy(c->staging+offset,p+10,count);
        for(unsigned i=offset;i<offset+count;i++)c->received[i/8]|=(uint8_t)(1u<<(i%8));
        c->last_activity=now;return GP_VENDOR_OK;
    }
    if(cmd==0x33) {
        if(n!=8)return GP_VENDOR_FORMAT;
        if(!c->active||!same(p,c->token,8))return GP_VENDOR_CONFLICT;
        for(unsigned i=0;i<FN_RGB_BYTES;i++)if(!(c->received[i/8]&(1u<<(i%8))))return GP_VENDOR_INCOMPLETE;
        if(gp_crc32(c->staging,FN_RGB_BYTES)!=c->checksum)return GP_VENDOR_CRC;
        if(!c->read(c->user,c->profile,c->layer,colors,&enabled,&revision))return GP_VENDOR_STORAGE;
        if(revision!=c->revision)return GP_VENDOR_CONFLICT;
        if(!c->install(c->user,c->profile,c->layer,c->staging,c->enabled,c->revision))return GP_VENDOR_STORAGE;
        c->active=false;
        if(!c->read(c->user,c->profile,c->layer,colors,&enabled,&revision))return GP_VENDOR_STORAGE;
        put32(out,revision);*length=4;return GP_VENDOR_OK;
    }
    return GP_VENDOR_UNSUPPORTED;
}
bool fn_rgb_handle(struct fn_rgb_context *c,const uint8_t request[64],uint8_t reply[64],uint32_t now) {
    if(request[0]!=0x10||request[1]<0x30||request[1]>0x35)return false;
    for(unsigned i=0;i<64;i++)reply[i]=0;
    copy(reply,request,4);reply[2]=1;copy(reply+4,(const uint8_t *)"FNR1",4);
    if(request[2]!=1||!same(request+4,(const uint8_t *)"FNR1",4)||request[8]||request[9]>54)reply[8]=GP_VENDOR_FORMAT;
    else reply[8]=process(c,request[1],request+10,request[9],reply+10,reply+9,now);
    return true;
}
