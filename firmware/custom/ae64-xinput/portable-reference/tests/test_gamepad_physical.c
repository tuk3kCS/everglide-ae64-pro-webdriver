/* Physical-unit and canonical stock-event adapter tests. No device access. */
#include "ae64_gamepad_physical.h"
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static unsigned checks;
#define CHECK(expr) do { ++checks; if (!(expr)) {fprintf(stderr,"failed %s:%d: %s\n",__FILE__,__LINE__,#expr);abort();} } while(0)
static void neutral(const struct gp_report *r){CHECK(!r->lx&&!r->ly&&!r->rx&&!r->ry&&!r->lt&&!r->rt&&!r->buttons&&!r->dpad);}
static uint64_t b(unsigned key){return UINT64_C(1)<<key;}
struct rig {struct gp_physical_config config;struct gp_physical_context ctx;struct gp_report report;uint16_t travel[GP_KEY_COUNT],maximum[GP_KEY_COUNT];struct gp_physical_frame frame;};
static void init(struct rig *r){memset(r,0,sizeof *r);gp_physical_config_empty(&r->config);r->config.mode=GP_CONTROLLER_ONLY;for(unsigned i=0;i<GP_KEY_COUNT;++i)r->maximum[i]=4000;r->frame=(struct gp_physical_frame){r->travel,r->maximum,UINT64_MAX,0,true,0};gp_physical_reset(&r->ctx);}
static bool tick(struct rig *r){++r->frame.now_ms;return gp_physical_update(&r->ctx,&r->config,&r->frame,&r->report);}
static void bind_analog(struct gp_physical_analog_key *key,uint8_t physical,uint16_t start,uint16_t end){key->key=physical;key->start_um=start;key->end_um=end;}
static void arm(struct rig *r){r->frame.stock_pressed=0;memset(r->travel,0,sizeof r->travel);CHECK(tick(r));neutral(&r->report);CHECK(!r->ctx.needs_release);}
static void test_validation(void){struct rig r;init(&r);CHECK(gp_physical_config_valid(&r.config,r.maximum));
 bind_analog(&r.config.trigger[0],0,1000,3000);CHECK(gp_physical_config_valid(&r.config,r.maximum));
 r.config.trigger[0].end_um=4500;CHECK(!gp_physical_config_valid(&r.config,r.maximum));r.config.trigger[0].end_um=3000;
 r.config.trigger[0].start_um=3000;CHECK(!gp_physical_config_valid(&r.config,r.maximum));r.config.trigger[0].start_um=1000;
 r.maximum[0]=9;CHECK(!gp_physical_config_valid(&r.config,r.maximum));r.maximum[0]=10001;CHECK(!gp_physical_config_valid(&r.config,r.maximum));
 r.maximum[0]=10;bind_analog(&r.config.trigger[0],0,0,10);CHECK(gp_physical_config_valid(&r.config,r.maximum));
 r.config.trigger[0].key=64;CHECK(!gp_physical_config_valid(&r.config,r.maximum));r.config.trigger[0].key=GP_NONE;CHECK(gp_physical_config_valid(&r.config,NULL));
 r.config.button[0]=63;CHECK(!gp_physical_config_valid(&r.config,NULL));r.maximum[63]=4000;CHECK(gp_physical_config_valid(&r.config,r.maximum));
 r.config.button[0]=64;CHECK(!gp_physical_config_valid(&r.config,r.maximum));r.config.button[0]=GP_NONE;
 r.config.trigger[0].curve.x[2]=r.config.trigger[0].curve.x[1];CHECK(!gp_physical_config_valid(&r.config,r.maximum));
}
static void test_requested_ranges(void){struct rig r;init(&r);bind_analog(&r.config.stick[0].x.positive,0,1000,3000);bind_analog(&r.config.trigger[0],1,500,3500);arm(&r);
 r.travel[0]=999;r.travel[1]=499;CHECK(tick(&r));CHECK(r.report.lx==0&&r.report.lt==0);
 r.travel[0]=1000;r.travel[1]=500;CHECK(tick(&r));CHECK(r.report.lx==0&&r.report.lt==0);
 r.travel[0]=2000;r.travel[1]=2000;CHECK(tick(&r));CHECK(r.report.lx==16383&&r.report.lt==127);
 r.travel[0]=3000;r.travel[1]=3500;CHECK(tick(&r));CHECK(r.report.lx==INT16_MAX&&r.report.lt==255);
 r.travel[0]=4000;r.travel[1]=4000;CHECK(tick(&r));CHECK(r.report.lx==INT16_MAX&&r.report.lt==255);
 r.travel[0]=4001;CHECK(!tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
}
static void test_unequal_strokes_and_triggers(void){struct rig r;init(&r);r.maximum[0]=3300;r.maximum[1]=5000;r.maximum[2]=3600;r.maximum[3]=4200;
 bind_analog(&r.config.stick[0].x.negative,0,1000,3000);bind_analog(&r.config.stick[0].x.positive,1,1000,3000);
 bind_analog(&r.config.trigger[0],2,500,3500);bind_analog(&r.config.trigger[1],3,500,3500);arm(&r);
 r.travel[0]=r.travel[1]=3000;r.travel[2]=r.travel[3]=3500;CHECK(tick(&r));CHECK(r.report.lx==0&&r.report.lt==255&&r.report.rt==255);
 r.travel[0]=0;r.travel[1]=2000;r.travel[2]=r.travel[3]=2000;CHECK(tick(&r));CHECK(r.report.lx>=16380&&r.report.lx<=16386);CHECK(r.report.lt==127&&r.report.rt==127);
 r.travel[0]=3000;r.travel[1]=0;r.travel[2]=3500;r.travel[3]=500;CHECK(tick(&r));CHECK(r.report.lx==INT16_MIN&&r.report.lt==255&&r.report.rt==0);
}
static void test_stock_pressed_semantics(void){struct rig r;init(&r);r.config.button[GP_A]=0;r.config.dpad[GP_UP]=1;r.config.dpad[GP_DOWN]=2;
 /* A released canonical key may physically remain deep under existing RT rules. */
 r.travel[0]=3000;CHECK(tick(&r));CHECK(!r.ctx.needs_release);neutral(&r.report);
 /* Pressed events are accepted at zero physical travel: no new analog threshold. */
 r.travel[0]=0;r.frame.stock_pressed=b(0);CHECK(tick(&r));CHECK(r.report.buttons==(1u<<GP_A));
 /* RT release immediately releases the button despite a large remaining depth. */
 r.travel[0]=3900;r.frame.stock_pressed=0;CHECK(tick(&r));CHECK(r.report.buttons==0);
 r.frame.stock_pressed=b(0)|b(1)|b(2);CHECK(tick(&r));CHECK(r.report.buttons==1&&r.report.dpad==0);
 r.frame.stock_pressed_valid=false;CHECK(!tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
 r.frame.stock_pressed_valid=true;CHECK(tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
 r.frame.stock_pressed=0;CHECK(tick(&r));neutral(&r.report);CHECK(!r.ctx.needs_release);
 r.frame.stock_pressed=b(0);CHECK(tick(&r));CHECK(r.report.buttons==1);
}
static void test_duplicates_and_dpad(void){struct rig r;init(&r);r.config.button[GP_A]=0;r.config.button[GP_B]=0;r.config.dpad[GP_UP]=1;r.config.dpad[GP_RIGHT]=2;r.config.dpad[GP_LEFT]=3;bind_analog(&r.config.trigger[0],0,500,3500);CHECK(gp_physical_config_valid(&r.config,r.maximum));arm(&r);
 r.travel[0]=2000;r.frame.stock_pressed=b(0)|b(1)|b(2);CHECK(tick(&r));CHECK(r.report.buttons==3&&r.report.lt==127&&r.report.dpad==9);
 r.frame.stock_pressed=b(1)|b(2)|b(3);CHECK(tick(&r));CHECK(r.report.buttons==0&&r.report.lt==127&&r.report.dpad==1);
}
static void test_rearm_changes_faults(void){struct rig r;init(&r);bind_analog(&r.config.trigger[0],0,500,3500);r.config.button[GP_A]=1;arm(&r);
 r.travel[0]=2000;r.frame.stock_pressed=b(1);CHECK(tick(&r));CHECK(r.report.lt==127&&r.report.buttons==1);
 ++r.config.revision;CHECK(tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
 r.frame.stock_pressed=0;CHECK(tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
 r.travel[0]=500;CHECK(tick(&r));neutral(&r.report);CHECK(!r.ctx.needs_release);
 r.travel[0]=3500;r.frame.stock_pressed=b(1);CHECK(tick(&r));CHECK(r.report.lt==255&&r.report.buttons==1);
 r.maximum[0]=4500;CHECK(tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
 r.travel[0]=0;r.frame.stock_pressed=0;CHECK(tick(&r));CHECK(!r.ctx.needs_release);
 r.travel[0]=3500;r.frame.stock_pressed=b(1);CHECK(tick(&r));CHECK(r.report.lt==255&&r.report.buttons==1);
 r.frame.valid_mask&=~b(1);CHECK(!tick(&r));neutral(&r.report);r.frame.valid_mask=UINT64_MAX;CHECK(tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
 r.config.mode=GP_OFF;CHECK(tick(&r));neutral(&r.report);r.frame.travel_um=NULL;r.frame.stock_pressed_valid=false;CHECK(tick(&r));neutral(&r.report);
 r.config.mode=GP_CONTROLLER_ONLY;r.frame.travel_um=r.travel;r.frame.stock_pressed_valid=true;CHECK(tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
}
static void test_watchdog_and_nulls(void){struct rig r;init(&r);r.config.button[GP_A]=0;arm(&r);r.frame.stock_pressed=b(0);r.frame.now_ms=UINT32_MAX-8;CHECK(tick(&r));CHECK(r.report.buttons==1);
 CHECK(!gp_physical_watchdog(&r.ctx,5,20,&r.report));CHECK(gp_physical_watchdog(&r.ctx,50,20,&r.report));neutral(&r.report);CHECK(r.ctx.needs_release);CHECK(!gp_physical_watchdog(&r.ctx,51,20,&r.report));
 r.frame.now_ms=60;CHECK(tick(&r));neutral(&r.report);CHECK(r.ctx.needs_release);
 r.frame.stock_pressed=0;CHECK(tick(&r));CHECK(!r.ctx.needs_release);
 CHECK(!gp_physical_update(&r.ctx,&r.config,NULL,&r.report));neutral(&r.report);
 CHECK(!gp_physical_update(NULL,&r.config,&r.frame,&r.report));neutral(&r.report);
 CHECK(!gp_physical_update(&r.ctx,&r.config,&r.frame,NULL));
}
static void test_masks_and_curves(void){struct rig r;init(&r);r.config.button[0]=63;r.config.dpad[0]=1;bind_analog(&r.config.trigger[0],2,500,3500);
 CHECK(gp_physical_bound_keys(&r.config,r.maximum)==(b(63)|b(1)|b(2)));CHECK(gp_physical_keyboard_suppression(&r.config,r.maximum)==(b(63)|b(1)|b(2)));
 r.config.mode=GP_MIXED;CHECK(gp_physical_keyboard_suppression(&r.config,r.maximum)==0);r.config.mode=GP_CONTROLLER_ONLY;
 r.config.trigger[0].curve=(struct gp_curve){{0,2500,7500,10000},{0,1000,9000,10000}};arm(&r);unsigned prior=0;
 for(unsigned um=500;um<=3500;um+=10){r.travel[2]=(uint16_t)um;CHECK(tick(&r));CHECK(r.report.lt>=prior);prior=r.report.lt;}CHECK(prior==255);
 r.maximum[63]=0;CHECK(!gp_physical_config_valid(&r.config,r.maximum));CHECK(gp_physical_bound_keys(&r.config,r.maximum)==0);CHECK(gp_physical_keyboard_suppression(&r.config,r.maximum)==0);
}
static uint32_t rnd=0x5462f191;static uint32_t random32(void){rnd^=rnd<<13;rnd^=rnd>>17;rnd^=rnd<<5;return rnd;}
static void test_randomized(void){struct rig r;init(&r);for(unsigned i=0;i<GP_KEY_COUNT;++i)r.maximum[i]=(uint16_t)(3300+(i%15)*100);
 struct gp_physical_analog_key *keys[]={&r.config.stick[0].x.negative,&r.config.stick[0].x.positive,&r.config.stick[0].y.negative,&r.config.stick[0].y.positive,&r.config.stick[1].x.negative,&r.config.stick[1].x.positive,&r.config.stick[1].y.negative,&r.config.stick[1].y.positive,&r.config.trigger[0],&r.config.trigger[1]};
 for(unsigned i=0;i<10;++i)bind_analog(keys[i],(uint8_t)i,500,3000);
 for(unsigned i=0;i<GP_BUTTON_COUNT;++i)r.config.button[i]=(uint8_t)(10+i);for(unsigned i=0;i<4;++i)r.config.dpad[i]=(uint8_t)(20+i);arm(&r);
 for(unsigned n=0;n<10000;++n){for(unsigned i=0;i<GP_KEY_COUNT;++i)r.travel[i]=(uint16_t)(random32()%(r.maximum[i]+1));r.frame.stock_pressed=random32();CHECK(tick(&r));
  CHECK((int64_t)r.report.lx*r.report.lx+(int64_t)r.report.ly*r.report.ly<=(int64_t)32768*32768);CHECK((int64_t)r.report.rx*r.report.rx+(int64_t)r.report.ry*r.report.ry<=(int64_t)32768*32768);
  CHECK((r.report.dpad&3)!=3&&(r.report.dpad&12)!=12);
  for(unsigned i=0;i<GP_BUTTON_COUNT;++i)CHECK(((r.report.buttons>>i)&1)==((r.frame.stock_pressed>>(10+i))&1));
 }
}
int main(void){test_validation();test_requested_ranges();test_unequal_strokes_and_triggers();test_stock_pressed_semantics();test_duplicates_and_dpad();test_rearm_changes_faults();test_watchdog_and_nulls();test_masks_and_curves();test_randomized();printf("Physical adapter: %u checks passed\n",checks);return 0;}
