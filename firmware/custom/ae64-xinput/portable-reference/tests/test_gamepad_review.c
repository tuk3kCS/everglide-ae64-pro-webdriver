/* Independent host-side review tests. No USB backend or device access. */
#include "ae64_gamepad.h"
#include <stdlib.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

static unsigned checks;
#define CHECK(expr) do { ++checks; if (!(expr)) { fprintf(stderr,"check failed at %s:%d: %s\n",__FILE__,__LINE__,#expr); abort(); } } while (0)
static const uint64_t ALL_KEYS=UINT64_MAX;
static struct gp_config make_config(void) {
    struct gp_config c; gp_config_empty(&c); c.mode=GP_CONTROLLER_ONLY;
    c.stick[0].x.negative.key=0;c.stick[0].x.positive.key=1;
    c.stick[0].y.positive.key=2;c.stick[0].y.negative.key=3;
    c.stick[1].x.negative.key=4;c.stick[1].x.positive.key=5;
    c.stick[1].y.positive.key=6;c.stick[1].y.negative.key=7;
    c.trigger[0].key=8;c.trigger[1].key=9;
    for (unsigned i=0;i<GP_BUTTON_COUNT;++i)c.button[i].key=(uint8_t)(10+i);
    for (unsigned i=0;i<4;++i)c.dpad[i].key=(uint8_t)(20+i);
    return c;
}
static int16_t get_s16(const uint8_t *p){return (int16_t)((uint16_t)p[0]|((uint16_t)p[1]<<8));}
static void is_neutral(const struct gp_report *r) {
    CHECK(r->lx==0&&r->ly==0&&r->rx==0&&r->ry==0&&r->lt==0&&r->rt==0&&r->buttons==0&&r->dpad==0);
}
static void arm(struct gp_context *ctx,const struct gp_config *cfg,uint16_t *d,struct gp_report *r) {
    memset(d,0,GP_KEY_COUNT*sizeof *d);gp_reset(ctx);
    CHECK(gp_update(ctx,cfg,d,ALL_KEYS,0,r));is_neutral(r);CHECK(!ctx->needs_release);
}
static void test_config(void) {
    struct gp_config base=make_config(),c;CHECK(gp_config_valid(&base));
    c=base;c.stick[0].x.positive.key=64;CHECK(!gp_config_valid(&c));
    c=base;c.stick[0].x.positive.key=GP_NONE;CHECK(gp_config_valid(&c));
    c=base;c.stick[0].x.positive.curve.x[2]=c.stick[0].x.positive.curve.x[1];CHECK(!gp_config_valid(&c));
    c=base;c.trigger[0].curve.y[2]=0;CHECK(!gp_config_valid(&c));
    c=base;c.trigger[0].start=c.trigger[0].end;CHECK(!gp_config_valid(&c));
    c=base;c.stick[0].radial_deadzone=10000;CHECK(!gp_config_valid(&c));
    c=base;c.stick[0].circular=false;c.stick[0].radial_deadzone=1;CHECK(!gp_config_valid(&c));
    c=base;c.stick[0].x.opposition=(enum gp_opposition)3;CHECK(!gp_config_valid(&c));
    c=base;c.button[0].release=c.button[0].press;CHECK(!gp_config_valid(&c));
    c=base;c.button[0].press=10001;CHECK(!gp_config_valid(&c));
    gp_config_empty(&c);c.mode=GP_CONTROLLER_ONLY;c.button[0].key=63;
    CHECK(gp_bound_keys(&c)==(UINT64_C(1)<<63));CHECK(gp_keyboard_suppression(&c)==(UINT64_C(1)<<63));
    c.mode=GP_MIXED;CHECK(gp_keyboard_suppression(&c)==0);c.mode=GP_OFF;CHECK(gp_keyboard_suppression(&c)==0);
}
static void test_arm_and_revision(void) {
    struct gp_config c=make_config();struct gp_context ctx;struct gp_report r;uint16_t d[GP_KEY_COUNT]={0};
    gp_reset(&ctx);d[1]=10000;
    CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));is_neutral(&r);CHECK(ctx.needs_release);
    d[1]=0;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,2,&r));is_neutral(&r);CHECK(!ctx.needs_release);
    d[1]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,3,&r));CHECK(r.lx==INT16_MAX);
    ++c.revision;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,4,&r));is_neutral(&r);CHECK(ctx.needs_release);
    d[1]=0;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,5,&r));d[1]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,6,&r));CHECK(r.lx==INT16_MAX);
    c.mode=GP_OFF;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,7,&r));is_neutral(&r);
    c.mode=GP_MIXED;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,8,&r));is_neutral(&r);CHECK(ctx.needs_release);
}
static void test_calibration_and_watchdog(void) {
    struct gp_config c=make_config();struct gp_context ctx;struct gp_report r;uint16_t d[GP_KEY_COUNT];arm(&ctx,&c,d,&r);
    d[10]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,UINT32_MAX-7,&r));CHECK(r.buttons&1);
    CHECK(!gp_watchdog(&ctx,5,20,&r));CHECK(gp_watchdog(&ctx,50,20,&r));is_neutral(&r);CHECK(ctx.needs_release);
    CHECK(!gp_watchdog(&ctx,100,20,&r));
    CHECK(gp_update(&ctx,&c,d,ALL_KEYS,101,&r));is_neutral(&r);
    d[10]=0;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,102,&r));
    d[10]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,103,&r));CHECK(r.buttons&1);
    CHECK(!gp_update(&ctx,&c,d,ALL_KEYS&~(UINT64_C(1)<<8),104,&r));is_neutral(&r);CHECK(ctx.needs_release);
    CHECK(gp_update(&ctx,&c,d,ALL_KEYS,105,&r));is_neutral(&r);
    CHECK(!gp_update(&ctx,&c,NULL,ALL_KEYS,106,&r));is_neutral(&r);
    CHECK(!gp_update(NULL,&c,d,ALL_KEYS,107,&r));is_neutral(&r);
}
static void test_digital(void) {
    struct gp_config c=make_config();struct gp_context ctx;struct gp_report r;uint16_t d[GP_KEY_COUNT];arm(&ctx,&c,d,&r);
    d[10]=4999;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));CHECK(!(r.buttons&1));
    d[10]=5000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,2,&r));CHECK(r.buttons&1);
    d[10]=4000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,3,&r));CHECK(r.buttons&1);
    d[10]=3000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,4,&r));CHECK(!(r.buttons&1));
    d[20]=d[21]=d[22]=d[23]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,5,&r));CHECK(r.dpad==0);
    d[21]=d[22]=0;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,6,&r));CHECK(r.dpad==9);
    d[10]=UINT16_MAX;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,7,&r));CHECK(r.buttons&1);
}
static void test_opposition(void) {
    struct gp_config c=make_config();c.stick[0].circular=false;struct gp_context ctx;struct gp_report r;uint16_t d[GP_KEY_COUNT];arm(&ctx,&c,d,&r);
    d[0]=3000;d[1]=8000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));CHECK(r.lx==16383);
    c.stick[0].x.opposition=GP_NEUTRAL_ON_BOTH;++c.revision;arm(&ctx,&c,d,&r);
    d[0]=3000;d[1]=8000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));CHECK(r.lx==0);
    c.stick[0].x.opposition=GP_DEEPER_WINS;++c.revision;arm(&ctx,&c,d,&r);
    d[0]=3000;d[1]=8000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));CHECK(r.lx==(int16_t)(8000*32767/10000));
    d[0]=d[1]=8000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,2,&r));CHECK(r.lx==0);
    d[0]=10000;d[1]=0;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,3,&r));CHECK(r.lx==INT16_MIN);
    d[0]=0;d[1]=10000;d[2]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,4,&r));CHECK(r.lx==INT16_MAX&&r.ly==INT16_MAX);
}
static void test_sticks(void) {
    struct gp_config c=make_config();struct gp_context ctx;struct gp_report r;uint16_t d[GP_KEY_COUNT];arm(&ctx,&c,d,&r);
    d[1]=d[2]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));
    CHECK(r.lx==r.ly&&r.lx>23000&&r.lx<23200);
    CHECK((int64_t)r.lx*r.lx+(int64_t)r.ly*r.ly<=(int64_t)32767*32767);
    c.stick[0].radial_deadzone=2000;++c.revision;arm(&ctx,&c,d,&r);
    d[1]=2000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));CHECK(r.lx==0);
    d[1]=3000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,2,&r));CHECK(r.lx==4095);
    d[1]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,3,&r));CHECK(r.lx==INT16_MAX);
    d[1]=0;d[3]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,4,&r));CHECK(r.ly==INT16_MIN);
    uint8_t hid[GP_HID_REPORT_BYTES];gp_encode_hid(&r,hid);CHECK(get_s16(hid+6)==INT16_MAX);
}
static void test_triggers_and_curve(void) {
    struct gp_config c=make_config();c.trigger[0].start=2500;c.trigger[0].end=7500;
    struct gp_context ctx;struct gp_report r;uint16_t d[GP_KEY_COUNT];arm(&ctx,&c,d,&r);
    d[8]=2500;d[9]=10000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,1,&r));CHECK(r.lt==0&&r.rt==255);
    d[8]=5000;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,2,&r));CHECK(r.lt==127&&r.rt==255);
    d[8]=7500;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,3,&r));CHECK(r.lt==255);
    d[8]=UINT16_MAX;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,4,&r));CHECK(r.lt==255);
    c.trigger[0].curve=(struct gp_curve){{0,2500,7500,10000},{0,1000,9000,10000}};++c.revision;arm(&ctx,&c,d,&r);
    unsigned previous=0;
    for (unsigned depth=2500;depth<=7500;depth+=25) {d[8]=(uint16_t)depth;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,depth,&r));CHECK(r.lt>=previous);previous=r.lt;}
    CHECK(previous==255);
}
static void test_encoding(void) {
    struct gp_report r={.lx=INT16_MIN,.ly=INT16_MIN,.rx=12345,.ry=INT16_MAX,.lt=0x12,.rt=0x34,.buttons=0x03ff,.dpad=9};
    uint8_t h[GP_HID_REPORT_BYTES],x[12];gp_encode_hid(&r,h);gp_encode_xinput_state(&r,x);
    CHECK(h[0]==5&&h[1]==0xff&&h[2]==3&&h[3]==1);
    CHECK(get_s16(h+4)==INT16_MIN&&get_s16(h+6)==INT16_MAX&&get_s16(h+8)==12345&&get_s16(h+10)==-32767);
    CHECK(h[12]==0x12&&h[13]==0x34);
    CHECK(x[0]==0xf9&&x[1]==0xf3&&x[2]==0x12&&x[3]==0x34);
    CHECK(get_s16(x+4)==INT16_MIN&&get_s16(x+6)==INT16_MIN&&get_s16(x+8)==12345&&get_s16(x+10)==INT16_MAX);
    r.dpad=15;gp_encode_hid(&r,h);gp_encode_xinput_state(&r,x);CHECK(h[3]==8&&x[0]==0xf0&&x[1]==0xf3);
}
static void test_descriptor_size(void) {
    unsigned size=0,count=0,reportid=0,bits=0;size_t i=0;
    while(i<gp_hid_report_descriptor_size){unsigned p=gp_hid_report_descriptor[i++],n=p&3;if(n==3)n=4;unsigned val=0;CHECK(i+n<=gp_hid_report_descriptor_size);for(unsigned j=0;j<n;++j)val|=(unsigned)gp_hid_report_descriptor[i++]<<(8*j);
        unsigned type=(p>>2)&3,tag=p>>4;
        if(type==1&&tag==7)size=val;if(type==1&&tag==8)reportid=val;if(type==1&&tag==9)count=val;
        if(type==0&&tag==8){CHECK(reportid==5);bits+=size*count;}
    }
    CHECK(bits==104&&bits/8+1==GP_HID_REPORT_BYTES);
}
static uint32_t random_state=0x32dbf91a;
static uint32_t next_random(void){random_state^=random_state<<13;random_state^=random_state>>17;random_state^=random_state<<5;return random_state;}
static void test_bounded_frames(void) {
    struct gp_config c=make_config();struct gp_context ctx;struct gp_report r;uint16_t d[GP_KEY_COUNT];arm(&ctx,&c,d,&r);
    for(unsigned n=1;n<=20000;++n){for(unsigned k=0;k<GP_KEY_COUNT;++k)d[k]=(uint16_t)(next_random()%13000);
        CHECK(gp_update(&ctx,&c,d,ALL_KEYS,n,&r));
        CHECK((int64_t)r.lx*r.lx+(int64_t)r.ly*r.ly<=(int64_t)32768*32768);
        CHECK((int64_t)r.rx*r.rx+(int64_t)r.ry*r.ry<=(int64_t)32768*32768);
        CHECK((r.buttons&~0x03ffu)==0&&(r.dpad&3u)!=3u&&(r.dpad&12u)!=12u);
        struct gp_report second;CHECK(gp_update(&ctx,&c,d,ALL_KEYS,n,&second));CHECK(gp_report_equal(&r,&second));
    }
}
int main(void){test_config();test_arm_and_revision();test_calibration_and_watchdog();test_digital();test_opposition();test_sticks();test_triggers_and_curve();test_encoding();test_descriptor_size();test_bounded_frames();printf("Independent gamepad review: %u checks passed\n",checks);return 0;}
