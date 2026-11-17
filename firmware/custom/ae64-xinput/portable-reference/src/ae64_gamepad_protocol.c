/* Original AGP1 configuration staging protocol. SPDX-License-Identifier: MIT */
#include "ae64_gamepad_protocol.h"

static uint16_t u16(const uint8_t *p) { return (uint16_t)((uint16_t)p[0] | (uint16_t)((uint16_t)p[1]<<8)); }
static uint32_t u32(const uint8_t *p) { return (uint32_t)p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24; }
static void p16(uint8_t *p,uint16_t x) { p[0]=(uint8_t)x;p[1]=(uint8_t)(x>>8); }
static void p32(uint8_t *p,uint32_t x) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(x>>(i*8)); }
static void copy(uint8_t *d,const uint8_t *s,size_t n) { for(size_t i=0;i<n;i++)d[i]=s[i]; }
static void clear(uint8_t *d,size_t n) { for(size_t i=0;i<n;i++)d[i]=0; }
uint32_t gp_crc32(const uint8_t *data,size_t length) {
    uint32_t crc=UINT32_MAX;
    for(size_t i=0;i<length;i++) { crc^=data[i];for(unsigned b=0;b<8;b++)crc=(crc>>1)^((crc&1)?UINT32_C(0xedb88320):0); }
    return crc^UINT32_MAX;
}
static bool magic(const uint8_t *p,const char *s) { return p[0]==(uint8_t)s[0]&&p[1]==(uint8_t)s[1]&&p[2]==(uint8_t)s[2]&&p[3]==(uint8_t)s[3]; }
static bool token_equal(const uint8_t *a,const uint8_t *b) { uint8_t d=0;for(unsigned i=0;i<8;i++)d|=a[i]^b[i];return d==0; }
static bool token_nonzero(const uint8_t *p) { uint8_t d=0;for(unsigned i=0;i<8;i++)d|=p[i];return d!=0; }
static struct gp_physical_analog_key *analog_slot(struct gp_physical_config *c,unsigned i) {
    if(i<2)return &c->trigger[i];
    struct gp_physical_axis *axis[4]={&c->stick[0].x,&c->stick[0].y,&c->stick[1].x,&c->stick[1].y};
    i-=2;return i%2?&axis[i/2]->positive:&axis[i/2]->negative;
}
bool gp_wire_decode(const uint8_t wire[GP_WIRE_BYTES],uint32_t revision,
                    const uint16_t max_um[GP_KEY_COUNT],struct gp_physical_config *out,uint8_t *transport) {
    if(!wire||!max_um||!out||!transport||!magic(wire,"AGC1")||wire[4]!=1||wire[5]>2||wire[6]<1||wire[6]>2||wire[9]||u16(wire+14)!=24)return false;
    struct gp_physical_config c;gp_physical_config_empty(&c);c.revision=revision;c.mode=(enum gp_mode)wire[5];
    for(unsigned s=0;s<2;s++) {
        uint8_t f=wire[7+s];uint16_t dead=u16(wire+10+s*2);
        if((f&~7u)||(f>>1)>2||dead>=9500||(!(f&1u)&&dead))return false;
        c.stick[s].circular=(f&1u)!=0;c.stick[s].radial_deadzone=dead;
        c.stick[s].x.opposition=c.stick[s].y.opposition=(enum gp_opposition)(f>>1);
    }
    uint64_t assigned=0;
    for(unsigned i=0;i<24;i++) {
        const uint8_t *b=wire+16+i*8;uint8_t key=b[0],curve=b[1];
        uint16_t start=u16(b+2),end=u16(b+4),declared=u16(b+6);
        if((key>=GP_KEY_COUNT&&key!=GP_NONE)||curve>1||declared<10||declared>10000||start>=end||end>declared)return false;
        if(key!=GP_NONE) { uint64_t bit=UINT64_C(1)<<key;if(assigned&bit)return false;assigned|=bit; }
        if(i<10) {
            struct gp_physical_analog_key *a=analog_slot(&c,i);a->key=key;a->start_um=start;a->end_um=end;gp_linear_curve(&a->curve);
            if(curve){a->curve.y[1]=2592;a->curve.y[2]=7408;}
        } else if(i<20)c.button[i-10]=key;
        else c.dpad[i-20]=key;
    }
    if(!gp_physical_config_valid(&c,max_um))return false;
    *out=c;*transport=wire[6];return true;
}
bool gp_vendor_init(struct gp_vendor_context *ctx,const uint8_t initial[GP_WIRE_BYTES],uint32_t revision,
                    uint8_t caps,const uint16_t max_um[GP_KEY_COUNT],gp_install_fn install,void *user) {
    if(!ctx||!initial||!max_um||(caps&~7u))return false;
    struct gp_physical_config config;uint8_t transport;
    if(!gp_wire_decode(initial,revision,max_um,&config,&transport))return false;
    if(config.mode!=GP_OFF&&!(caps&transport))return false;
    uint8_t initial_copy[GP_WIRE_BYTES];uint16_t maximum_copy[GP_KEY_COUNT];
    copy(initial_copy,initial,GP_WIRE_BYTES);for(unsigned i=0;i<GP_KEY_COUNT;i++)maximum_copy[i]=max_um[i];
    *ctx=(struct gp_vendor_context){0};copy(ctx->active,initial_copy,GP_WIRE_BYTES);
    for(unsigned i=0;i<GP_KEY_COUNT;i++)ctx->max_travel_um[i]=maximum_copy[i];
    ctx->revision=revision;ctx->capabilities=caps;ctx->install=install;ctx->user=user;ctx->initialized=true;return true;
}
static uint8_t process(struct gp_vendor_context *ctx,uint8_t command,const uint8_t *p,uint8_t n,uint8_t *reply,uint8_t *length) {
    if(!ctx||!ctx->initialized)return GP_VENDOR_BACKEND;
    *length=0;
    if(command==0x20) {
        if(n)return GP_VENDOR_FORMAT;
        p32(reply,UINT32_C(0x0030000a));reply[4]=ctx->capabilities;reply[5]=24;reply[6]=1;reply[7]=0;
        p32(reply+8,ctx->revision);p16(reply+12,10000);p16(reply+14,GP_WIRE_BYTES);p32(reply+16,gp_crc32(ctx->active,GP_WIRE_BYTES));*length=20;return GP_VENDOR_OK;
    }
    if(command==0x25) {
        if(n!=7||p[6]>48||!p[6]||(size_t)u16(p+4)+p[6]>GP_WIRE_BYTES)return GP_VENDOR_FORMAT;
        if(u32(p)!=ctx->revision)return GP_VENDOR_CONFLICT;
        p32(reply,ctx->revision);p16(reply+4,u16(p+4));copy(reply+6,ctx->active+u16(p+4),p[6]);*length=(uint8_t)(6+p[6]);return GP_VENDOR_OK;
    }
    if(command==0x24) {
        if(n!=8)return GP_VENDOR_FORMAT;
        if(ctx->staging_active&&!token_equal(p,ctx->transaction))return GP_VENDOR_CONFLICT;
        ctx->staging_active=false;return GP_VENDOR_OK;
    }
    if(!ctx->install)return GP_VENDOR_BACKEND;
    if(command==0x21) {
        if(n!=18||u16(p+8)!=GP_WIRE_BYTES||!token_nonzero(p+10))return GP_VENDOR_FORMAT;
        if(u32(p)!=ctx->revision)return GP_VENDOR_CONFLICT;
        if(ctx->staging_active) {
            if(!token_equal(p+10,ctx->transaction)||u32(p+4)!=ctx->staged_crc||u32(p)!=ctx->staged_revision)return GP_VENDOR_CONFLICT;
            ctx->last_activity_ms=ctx->now_ms;return GP_VENDOR_OK;
        }
        ctx->staging_active=true;ctx->staged_revision=u32(p);ctx->staged_crc=u32(p+4);copy(ctx->transaction,p+10,8);
        ctx->last_activity_ms=ctx->now_ms;clear(ctx->received,GP_WIRE_BYTES);return GP_VENDOR_OK;
    }
    if(command==0x22) {
        if(!ctx->staging_active)return GP_VENDOR_CONFLICT;
        if(n<11||n>54||(size_t)u16(p+8)+n-10>GP_WIRE_BYTES)return GP_VENDOR_FORMAT;
        if(!token_equal(p,ctx->transaction))return GP_VENDOR_CONFLICT;
        ctx->last_activity_ms=ctx->now_ms;
        unsigned start=u16(p+8);for(unsigned i=0;i<(unsigned)n-10;i++){ctx->staging[start+i]=p[10+i];ctx->received[start+i]=1;}return GP_VENDOR_OK;
    }
    if(command==0x23) {
        if(n!=16)return GP_VENDOR_FORMAT;
        if(!ctx->staging_active||ctx->staged_revision!=ctx->revision||!token_equal(p,ctx->transaction)||u32(p+8)!=ctx->staged_crc||u32(p+12)!=ctx->revision)return GP_VENDOR_CONFLICT;
        for(unsigned i=0;i<GP_WIRE_BYTES;i++)if(!ctx->received[i])return GP_VENDOR_INCOMPLETE;
        if(gp_crc32(ctx->staging,GP_WIRE_BYTES)!=ctx->staged_crc)return GP_VENDOR_CRC;
        struct gp_physical_config config;uint8_t transport;uint32_t revision=ctx->revision+1;
        if(!gp_wire_decode(ctx->staging,revision,ctx->max_travel_um,&config,&transport))return GP_VENDOR_CONFIG;
        if(config.mode!=GP_OFF&&!(ctx->capabilities&transport))return GP_VENDOR_BACKEND;
        if(!ctx->install(ctx->user,&config,transport,ctx->staging))return GP_VENDOR_STORAGE;
        copy(ctx->active,ctx->staging,GP_WIRE_BYTES);ctx->revision=revision;ctx->staging_active=false;
        p32(reply,revision);reply[4]=(ctx->capabilities&GP_CAP_PERSISTENT)?1:0;*length=5;return GP_VENDOR_OK;
    }
    return GP_VENDOR_UNSUPPORTED;
}
bool gp_vendor_handle(struct gp_vendor_context *ctx,const uint8_t request[64],uint8_t reply[64],uint32_t now_ms) {
    if(!request||!reply||request[0]!=0x10||request[1]<0x20||request[1]>0x25||!magic(request+4,"AGP1"))return false;
    uint8_t incoming[64];copy(incoming,request,64);clear(reply,64);copy(reply,incoming,8);
    if(ctx) {
        ctx->now_ms=now_ms;
        if(ctx->staging_active&&(uint32_t)(now_ms-ctx->last_activity_ms)>GP_TRANSACTION_TIMEOUT_MS)ctx->staging_active=false;
    }
    if(incoming[2]!=1||incoming[8]||incoming[9]>54)reply[8]=GP_VENDOR_FORMAT;
    else reply[8]=process(ctx,incoming[1],incoming+10,incoming[9],reply+10,reply+9);
    if(reply[8]){reply[9]=0;clear(reply+10,54);}return true;
}
