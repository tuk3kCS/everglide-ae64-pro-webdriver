/* Portable differential test. Synthetic frames only; no board/USB operations. */
#include "ae64_gamepad_physical.h"
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks,frames;
#define CHECK(x) do { checks++;if(!(x)){fprintf(stderr,"FAIL %s:%d: %s (frame %u)\n",__FILE__,__LINE__,#x,frames);exit(1);} }while(0)
/* The layout before the cache was introduced. Keep the RAM budget executable. */
struct original_context {
    struct gp_context analog;
    uint32_t revision,last_frame_ms;
    enum gp_mode mode;
    bool configured,needs_release,has_frame;
    uint64_t bound_mask;
    uint16_t max_travel_um[GP_KEY_COUNT];
    struct gp_report report;
};
_Static_assert(sizeof(struct gp_physical_context)<=sizeof(struct original_context)+64,
               "Physical evaluator cache exceeds the 64-byte persistent RAM budget");
struct rig {
    struct gp_physical_config config;
    struct gp_physical_context reference,cached;
    uint16_t travel[GP_KEY_COUNT],maximum[GP_KEY_COUNT];
    struct gp_physical_frame frame;
    struct gp_report expected,actual;
};
static uint32_t seed=UINT32_C(0x839a614d);
static uint32_t random32(void) { seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return seed; }
static uint64_t random64(void) { return (uint64_t)random32()<<32|random32(); }
static uint64_t key_bit(unsigned key) { return UINT64_C(1)<<key; }
static void same_core(const struct gp_context *a,const struct gp_context *b) {
    CHECK(a->revision==b->revision);CHECK(a->last_frame_ms==b->last_frame_ms);CHECK(a->mode==b->mode);
    CHECK(a->configured==b->configured);CHECK(a->needs_release==b->needs_release);CHECK(a->has_frame==b->has_frame);
    CHECK(a->button_latches==b->button_latches);CHECK(a->dpad_latches==b->dpad_latches);CHECK(gp_report_equal(&a->report,&b->report));
}
static void same_context(const struct rig *r) {
    const struct gp_physical_context *a=&r->reference,*b=&r->cached;
    same_core(&a->analog,&b->analog);
    CHECK(a->revision==b->revision);CHECK(a->last_frame_ms==b->last_frame_ms);CHECK(a->mode==b->mode);
    CHECK(a->configured==b->configured);CHECK(a->needs_release==b->needs_release);CHECK(a->has_frame==b->has_frame);
    CHECK(a->bound_mask==b->bound_mask);CHECK(!memcmp(a->max_travel_um,b->max_travel_um,sizeof a->max_travel_um));
    CHECK(gp_report_equal(&a->report,&b->report));
}
static struct gp_physical_analog_key *binding(struct gp_physical_config *c,unsigned index) {
    unsigned s=index/5u,n=index%5u;
    if (n==4)return &c->trigger[s];
    struct gp_physical_axis *axis=n<2 ? &c->stick[s].x : &c->stick[s].y;
    return (n&1u) ? &axis->positive : &axis->negative;
}
static void init(struct rig *r) {
    memset(r,0,sizeof *r);gp_physical_config_empty(&r->config);r->config.mode=GP_CONTROLLER_ONLY;
    for (unsigned i=0;i<GP_KEY_COUNT;i++)r->maximum[i]=3310;
    r->frame=(struct gp_physical_frame){r->travel,r->maximum,UINT64_MAX,0,true,0};
    gp_physical_reset(&r->reference);gp_physical_reset(&r->cached);
}
static bool tick_with(struct rig *r,const struct gp_physical_config *config,const struct gp_physical_frame *frame) {
    memset(&r->expected,0xa5,sizeof r->expected);memset(&r->actual,0x5a,sizeof r->actual);frames++;
    bool a=gp_physical_update(&r->reference,config,frame,&r->expected),
         b=gp_physical_update_cached(&r->cached,config,frame,&r->actual);
    CHECK(a==b);CHECK(gp_report_equal(&r->expected,&r->actual));same_context(r);return a;
}
static bool tick(struct rig *r) { r->frame.now_ms++;return tick_with(r,&r->config,&r->frame); }
static void release(struct rig *r) {
    memset(r->travel,0,sizeof r->travel);r->frame.stock_pressed=0;r->frame.stock_pressed_valid=true;r->frame.valid_mask=UINT64_MAX;
    CHECK(tick(r));CHECK(r->config.mode==GP_OFF || !r->cached.needs_release);CHECK(gp_report_equal(&r->actual,&(struct gp_report){0}));
}
static void bind(struct gp_physical_analog_key *b,uint8_t key,uint16_t start,uint16_t end) { b->key=key;b->start_um=start;b->end_um=end; }
static void curves(struct gp_curve *curve,unsigned type) {
    gp_linear_curve(curve);
    if (type==1)*curve=(struct gp_curve){{0,3333,6667,10000},{0,2592,7408,10000}};
    if (type==2)*curve=(struct gp_curve){{0,1,9999,10000},{0,321,9876,10000}};
    if (type==3)*curve=(struct gp_curve){{0,2037,7654,10000},{0,0,10000,10000}};
}
static uint16_t oracle_level(uint16_t travel,uint16_t maximum,const struct gp_physical_analog_key *b) {
    uint32_t d=(uint32_t)travel*10000/maximum,s=(uint32_t)b->start_um*10000/maximum,e=(uint32_t)b->end_um*10000/maximum;
    if (d<=s)return 0;if (d>=e)return 10000;
    uint32_t x=(d-s)*10000/(e-s);
    for (unsigned i=1;i<4;i++)if (x<=b->curve.x[i])return (uint16_t)(b->curve.y[i-1]+(x-b->curve.x[i-1])*(b->curve.y[i]-b->curve.y[i-1])/(b->curve.x[i]-b->curve.x[i-1]));
    return 10000;
}
static void exhaustive_quantization(void) {
    const uint16_t maxima[]={10,11,999,3310,4000,10000};
    for (unsigned m=0;m<sizeof maxima/sizeof *maxima;m++)for (unsigned curve=0;curve<4;curve++) {
        struct rig r;init(&r);r.maximum[63]=maxima[m];
        bind(&r.config.trigger[0],63,(uint16_t)(maxima[m]/5),(uint16_t)(maxima[m]*4u/5));curves(&r.config.trigger[0].curve,curve);release(&r);
        for (unsigned depth=0;depth<=maxima[m];depth++) {
            r.travel[63]=(uint16_t)depth;CHECK(tick(&r));
            CHECK(r.actual.lt==(uint8_t)((uint32_t)oracle_level((uint16_t)depth,maxima[m],&r.config.trigger[0])*255/10000));
        }
        r.travel[63]=(uint16_t)(maxima[m]+1);CHECK(!tick(&r));CHECK(r.cached.needs_release);
        r.travel[63]=r.config.trigger[0].start_um;CHECK(tick(&r));CHECK(!r.cached.needs_release);CHECK(!r.actual.lt);
    }
}
static void random_config(struct rig *r,unsigned n) {
    gp_physical_config_empty(&r->config);r->config.revision=n;r->config.mode=(enum gp_mode)(n%3);
    for (unsigned key=0;key<GP_KEY_COUNT;key++)r->maximum[key]=(uint16_t)(10+random32()%9991);
    for (unsigned i=0;i<GP_PHYSICAL_ANALOG_COUNT;i++) {
        struct gp_physical_analog_key *b=binding(&r->config,i);
        if (random32()%7==0)continue;
        uint8_t key=(uint8_t)(random32()%GP_KEY_COUNT);uint16_t maximum=r->maximum[key];
        uint16_t start=(uint16_t)(random32()%(maximum-1)),end=(uint16_t)(start+1+random32()%(maximum-start));
        bind(b,key,start,end);curves(&b->curve,random32()%4);
    }
    for (unsigned s=0;s<2;s++) {
        r->config.stick[s].x.opposition=(enum gp_opposition)(random32()%3);r->config.stick[s].y.opposition=(enum gp_opposition)(random32()%3);
        r->config.stick[s].circular=(random32()&1)!=0;r->config.stick[s].radial_deadzone=r->config.stick[s].circular ? (uint16_t)(random32()%10000) : 0;
    }
    for (unsigned i=0;i<GP_BUTTON_COUNT;i++)r->config.button[i]=random32()%5 ? (uint8_t)(random32()%GP_KEY_COUNT) : GP_NONE;
    for (unsigned i=0;i<4;i++)r->config.dpad[i]=random32()%5 ? (uint8_t)(random32()%GP_KEY_COUNT) : GP_NONE;
    CHECK(gp_physical_config_valid(&r->config,r->maximum));
}
static void randomized_frames(void) {
    struct rig r;init(&r);
    for (unsigned generation=1;generation<=120;generation++) {
        random_config(&r,generation);release(&r);
        for (unsigned n=0;n<600;n++) {
            for (unsigned key=0;key<GP_KEY_COUNT;key++)r.travel[key]=(uint16_t)(random32()%(r.maximum[key]+1));
            r.frame.stock_pressed=random64();r.frame.stock_pressed_valid=true;r.frame.valid_mask=UINT64_MAX;r.frame.now_ms+=random32()%4;
            if (n%37==0) { release(&r);continue; }
            if (n%101==0)r.frame.valid_mask=0;
            if (n%103==0)r.frame.stock_pressed_valid=false;
            CHECK(tick(&r) || r.cached.needs_release);
            if (n%89==0) {
                struct gp_report a={0},b={0};uint32_t now=r.frame.now_ms+51;
                CHECK(gp_physical_watchdog(&r.reference,now,50,&a)==gp_physical_watchdog(&r.cached,now,50,&b));
                CHECK(gp_report_equal(&a,&b));same_context(&r);
            }
        }
    }
}
static void revision_calibration_and_addresses(void) {
    struct rig r;init(&r);bind(&r.config.trigger[0],0,500,3000);r.config.button[GP_A]=63;release(&r);
    r.travel[0]=2000;r.frame.stock_pressed=key_bit(63);CHECK(tick(&r));CHECK(r.actual.lt && r.actual.buttons);
    struct gp_physical_config copy=r.config;CHECK(tick_with(&r,&copy,&r.frame));CHECK(r.actual.lt && !r.cached.needs_release);
    CHECK(tick(&r));CHECK(r.actual.lt && !r.cached.needs_release);
    /* An unbound maximum is irrelevant, including unusable/sentinel values. */
    r.maximum[1]=0;CHECK(tick(&r));CHECK(r.actual.lt && !r.cached.needs_release);
    r.maximum[0]=4000;CHECK(tick(&r));CHECK(!r.actual.lt && r.cached.needs_release);release(&r);
    r.travel[0]=2000;r.frame.stock_pressed=key_bit(63);CHECK(tick(&r));CHECK(r.actual.lt);
    r.maximum[63]=4000;CHECK(tick(&r));CHECK(r.cached.needs_release);release(&r);
    r.travel[0]=2000;CHECK(tick(&r));CHECK(r.actual.lt);
    r.config.revision=UINT32_MAX;CHECK(tick(&r));CHECK(r.cached.needs_release);release(&r);
    r.config.revision=0;CHECK(tick(&r));CHECK(!r.actual.lt);CHECK(!r.cached.needs_release);
    r.config.mode=GP_OFF;CHECK(tick(&r));CHECK(r.cached.needs_release);
    r.frame.travel_um=NULL;r.frame.stock_pressed_valid=false;r.frame.valid_mask=0;CHECK(tick(&r));
    r.config.mode=GP_MIXED;CHECK(!tick(&r));r.frame.travel_um=r.travel;release(&r);
    r.travel[0]=2000;CHECK(tick(&r));
    gp_reset(&r.reference.analog);gp_reset(&r.cached.analog);CHECK(tick(&r));CHECK(!r.actual.lt);release(&r);
}
static void malformed_configs_and_frames(void) {
    for (unsigned fault=0;fault<15;fault++) {
        struct rig r;init(&r);bind(&r.config.trigger[0],1,500,3000);release(&r);r.config.revision++;
        switch (fault) {
        case 0:r.config.mode=(enum gp_mode)-1;break;
        case 1:r.config.trigger[0].key=64;break;
        case 2:r.config.trigger[0].start_um=3000;break;
        case 3:r.config.trigger[0].end_um=10001;break;
        case 4:r.config.trigger[0].curve.x[0]=1;break;
        case 5:r.config.trigger[0].curve.x[1]=r.config.trigger[0].curve.x[2];break;
        case 6:r.config.trigger[0].curve.y[2]=10001;break;
        case 7:r.config.trigger[0].curve.y[3]=9999;break;
        case 8:r.config.stick[0].radial_deadzone=10000;break;
        case 9:r.config.stick[0].circular=false;r.config.stick[0].radial_deadzone=1;break;
        case 10:r.config.stick[0].x.opposition=(enum gp_opposition)3;break;
        case 11:r.config.button[0]=64;break;
        case 12:r.config.dpad[0]=64;break;
        case 13:r.maximum[1]=9;break;
        default:r.maximum[1]=10001;break;
        }
        CHECK(!tick(&r));CHECK(!r.cached.configured);CHECK(!r.cached.validated_config_identity);
    }
    struct rig r;init(&r);bind(&r.config.trigger[0],0,500,3000);release(&r);
    r.frame.max_travel_um=NULL;CHECK(!tick(&r));r.frame.max_travel_um=r.maximum;release(&r);
    r.frame.travel_um=NULL;CHECK(!tick(&r));r.frame.travel_um=r.travel;release(&r);
    CHECK(!tick_with(&r,&r.config,NULL));release(&r);CHECK(!tick_with(&r,NULL,&r.frame));release(&r);
    CHECK(!gp_physical_update(&r.reference,&r.config,&r.frame,NULL));CHECK(!gp_physical_update_cached(&r.cached,&r.config,&r.frame,NULL));same_context(&r);
    CHECK(!gp_physical_update(NULL,&r.config,&r.frame,&r.expected));CHECK(!gp_physical_update_cached(NULL,&r.config,&r.frame,&r.actual));CHECK(gp_report_equal(&r.expected,&r.actual));
    gp_physical_config_empty(&r.config);r.config.revision++;r.config.mode=GP_MIXED;
    r.frame.max_travel_um=NULL;r.frame.travel_um=NULL;r.frame.stock_pressed_valid=false;r.frame.valid_mask=0;CHECK(tick(&r));CHECK(tick(&r));
    /* A new address is validated even with an unchanged revision. */
    struct gp_physical_config invalid=r.config;invalid.trigger[0].curve.x[0]=1;CHECK(!tick_with(&r,&invalid,&r.frame));
}
static void watchdog_wraparound(void) {
    struct rig r;init(&r);r.config.button[0]=63;release(&r);r.frame.stock_pressed=key_bit(63);r.frame.now_ms=UINT32_MAX-8;CHECK(tick(&r));
    struct gp_report a={0},b={0};
    CHECK(gp_physical_watchdog(&r.reference,5,20,&a)==gp_physical_watchdog(&r.cached,5,20,&b));same_context(&r);
    CHECK(gp_physical_watchdog(&r.reference,50,20,&a)==gp_physical_watchdog(&r.cached,50,20,&b));CHECK(gp_report_equal(&a,&b));same_context(&r);
    CHECK(tick(&r));CHECK(r.cached.needs_release);release(&r);r.frame.stock_pressed=key_bit(63);CHECK(tick(&r));CHECK(r.actual.buttons==1);
}
int main(void) {
    exhaustive_quantization();randomized_frames();revision_calibration_and_addresses();malformed_configs_and_frames();watchdog_wraparound();
    printf("Cached physical evaluator: %u checks / %u differential frames passed; context %zu -> %zu bytes (+%zu); no hardware accessed.\n",checks,frames,sizeof(struct original_context),sizeof(struct gp_physical_context),sizeof(struct gp_physical_context)-sizeof(struct original_context));
    return 0;
}
