/* Independent, offline AGP1 boundary/transaction review. SPDX-License-Identifier: MIT */
#include "ae64_gamepad_protocol.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static unsigned checks;
#define CHECK(x) do{++checks;if(!(x)){fprintf(stderr,"failed %s:%d: %s\n",__FILE__,__LINE__,#x);abort();}}while(0)
static void p16(uint8_t*p,uint16_t x){p[0]=(uint8_t)x;p[1]=(uint8_t)(x>>8);}
static void p32(uint8_t*p,uint32_t x){for(unsigned i=0;i<4;++i)p[i]=(uint8_t)(x>>(i*8));}
static uint32_t u32(const uint8_t*p){return(uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static const uint8_t A[8]={1,2,3,4,5,6,7,8},B[8]={8,7,6,5,4,3,2,1};
struct state{unsigned attempts,installed;bool accept;uint8_t saved[208];};
static bool install(void*user,const struct gp_physical_config*c,uint8_t transport,const uint8_t*wire){struct state*s=user;s->attempts++;CHECK(c->revision>0);CHECK(transport==1||transport==2);if(!s->accept)return false;s->installed++;memcpy(s->saved,wire,208);return true;}
struct rig{struct gp_vendor_context ctx;struct state state;uint16_t maximum[64];uint8_t initial[208],changed[208];};
static void wire(uint8_t*out){memset(out,0,208);memcpy(out,"AGC1",4);out[4]=1;out[5]=1;out[6]=1;out[7]=out[8]=1;p16(out+14,24);for(unsigned i=0;i<24;++i){unsigned o=16+i*8;out[o]=255;p16(out+o+4,1000);p16(out+o+6,4000);}out[16]=0;p16(out+18,1000);p16(out+20,3000);out[16+10*8]=1;}
static void init(struct rig*r){memset(r,0,sizeof*r);for(unsigned i=0;i<64;++i)r->maximum[i]=4000;wire(r->initial);memcpy(r->changed,r->initial,208);p16(r->changed+18,500);p16(r->changed+20,3500);r->state.accept=true;CHECK(gp_vendor_init(&r->ctx,r->initial,7,GP_CAP_HID|GP_CAP_XINPUT,r->maximum,install,&r->state));}
static void packet(uint8_t*q,uint8_t command,const uint8_t*p,uint8_t n){memset(q,0,64);q[0]=16;q[1]=command;q[2]=1;q[3]=83;memcpy(q+4,"AGP1",4);q[9]=n;if(p)memcpy(q+10,p,n>54?54:n);}
struct guard{uint8_t before[16],bytes[64],after[16];};
static uint8_t call(struct rig*r,uint8_t command,const uint8_t*p,uint8_t n,uint32_t now,uint8_t*result){uint8_t q[64];struct guard g;memset(&g,0xa5,sizeof g);packet(q,command,p,n);CHECK(gp_vendor_handle(&r->ctx,q,g.bytes,now));for(unsigned i=0;i<16;++i)CHECK(g.before[i]==0xa5&&g.after[i]==0xa5);CHECK(!memcmp(q,g.bytes,8));CHECK(g.bytes[9]<=54);if(g.bytes[8]){CHECK(g.bytes[9]==0);for(unsigned i=10;i<64;++i)CHECK(g.bytes[i]==0);}if(result)memcpy(result,g.bytes,64);return g.bytes[8];}
static uint8_t begin(struct rig*r,const uint8_t*token,const uint8_t*config,uint32_t crc,uint32_t revision,uint32_t now){(void)config;uint8_t p[18];p32(p,revision);p32(p+4,crc);p16(p+8,208);memcpy(p+10,token,8);return call(r,0x21,p,18,now,NULL);}
static uint8_t write_part(struct rig*r,const uint8_t*token,unsigned offset,const uint8_t*data,unsigned n,uint32_t now){uint8_t p[54];memcpy(p,token,8);p16(p+8,(uint16_t)offset);memcpy(p+10,data,n);return call(r,0x22,p,(uint8_t)(10+n),now,NULL);}
static void write_all(struct rig*r,const uint8_t*token,const uint8_t*data,uint32_t now){for(unsigned o=0;o<208;o+=40){unsigned n=208-o;if(n>40)n=40;CHECK(write_part(r,token,o,data+o,n,now+o)==GP_VENDOR_OK);}}
static uint8_t commit(struct rig*r,const uint8_t*token,uint32_t crc,uint32_t revision,uint32_t now){uint8_t p[16];memcpy(p,token,8);p32(p+8,crc);p32(p+12,revision);return call(r,0x23,p,16,now,NULL);}
static void unchanged(struct rig*r){CHECK(r->ctx.revision==7);CHECK(!memcmp(r->ctx.active,r->initial,208));CHECK(r->state.installed==0);}
static void test_alias_and_bounds(void){struct rig r;init(&r);uint8_t q[64];packet(q,0x20,NULL,0);CHECK(gp_vendor_handle(&r.ctx,q,q,0));CHECK(q[8]==0&&q[9]==20&&u32(q+10)==0x0030000a);
 struct{uint8_t pre[16],data[65],post[16];}overlap;memset(&overlap,0x5a,sizeof overlap);packet(overlap.data,0x20,NULL,0);CHECK(gp_vendor_handle(&r.ctx,overlap.data,overlap.data+1,1));CHECK(overlap.data[1+8]==0&&overlap.data[1+9]==20);for(unsigned i=0;i<16;++i)CHECK(overlap.pre[i]==0x5a&&overlap.post[i]==0x5a);
 uint8_t out[64];memset(out,0x5a,64);packet(q,0x20,NULL,0);q[4]='X';CHECK(!gp_vendor_handle(&r.ctx,q,out,2));for(unsigned i=0;i<64;++i)CHECK(out[i]==0x5a);
 uint32_t crc=gp_crc32(r.changed,208);CHECK(begin(&r,A,r.changed,crc,7,3)==0);uint8_t byte=1;CHECK(write_part(&r,A,208,&byte,1,4)==GP_VENDOR_FORMAT);CHECK(write_part(&r,A,65535,&byte,1,5)==GP_VENDOR_FORMAT);CHECK(write_part(&r,A,207,&byte,1,6)==0);
 uint8_t p[7];p32(p,7);p16(p+4,207);p[6]=2;CHECK(call(&r,0x25,p,7,7,NULL)==GP_VENDOR_FORMAT);p16(p+4,160);p[6]=48;CHECK(call(&r,0x25,p,7,8,NULL)==0);p[6]=49;CHECK(call(&r,0x25,p,7,9,NULL)==GP_VENDOR_FORMAT);unchanged(&r);
}
static void test_ownership_and_commit(void){struct rig r;init(&r);uint32_t crc=gp_crc32(r.changed,208);CHECK(begin(&r,A,r.changed,crc,7,100)==0);CHECK(write_part(&r,A,0,r.changed,40,101)==0);CHECK(begin(&r,A,r.changed,crc,7,102)==0);for(unsigned i=0;i<40;++i)CHECK(r.ctx.received[i]==1);
 CHECK(begin(&r,B,r.initial,gp_crc32(r.initial,208),7,103)==GP_VENDOR_CONFLICT);CHECK(write_part(&r,B,0,r.initial,40,104)==GP_VENDOR_CONFLICT);CHECK(commit(&r,B,crc,7,105)==GP_VENDOR_CONFLICT);CHECK(call(&r,0x24,B,8,106,NULL)==GP_VENDOR_CONFLICT);CHECK(r.ctx.staging_active&&!memcmp(r.ctx.transaction,A,8));unchanged(&r);
 CHECK(commit(&r,A,crc,7,107)==GP_VENDOR_INCOMPLETE);write_all(&r,A,r.changed,110);CHECK(commit(&r,A,crc^1,7,400)==GP_VENDOR_CONFLICT);CHECK(commit(&r,A,crc,6,401)==GP_VENDOR_CONFLICT);unchanged(&r);
 CHECK(commit(&r,A,crc,7,402)==0);CHECK(r.ctx.revision==8&&!r.ctx.staging_active&&r.state.installed==1);CHECK(!memcmp(r.ctx.active,r.changed,208)&&!memcmp(r.state.saved,r.changed,208));CHECK(commit(&r,A,crc,7,403)==GP_VENDOR_CONFLICT);
}
static void test_crc_config_and_callback(void){struct rig r;init(&r);uint32_t crc=gp_crc32(r.changed,208);CHECK(begin(&r,A,r.changed,crc^1,7,0)==0);write_all(&r,A,r.changed,1);CHECK(commit(&r,A,crc^1,7,300)==GP_VENDOR_CRC);unchanged(&r);CHECK(r.state.attempts==0);CHECK(call(&r,0x24,A,8,301,NULL)==0);
 uint8_t bad[208];memcpy(bad,r.changed,208);p16(bad+18,4000);crc=gp_crc32(bad,208);CHECK(begin(&r,A,bad,crc,7,302)==0);write_all(&r,A,bad,303);CHECK(commit(&r,A,crc,7,600)==GP_VENDOR_CONFIG);unchanged(&r);CHECK(r.state.attempts==0);CHECK(call(&r,0x24,A,8,601,NULL)==0);
 crc=gp_crc32(r.changed,208);CHECK(begin(&r,A,r.changed,crc,7,602)==0);write_all(&r,A,r.changed,603);r.state.accept=false;CHECK(commit(&r,A,crc,7,900)==GP_VENDOR_STORAGE);unchanged(&r);CHECK(r.state.attempts==1&&r.ctx.staging_active);r.state.accept=true;CHECK(commit(&r,A,crc,7,901)==0);CHECK(r.state.attempts==2&&r.state.installed==1&&r.ctx.revision==8);
}
static void test_expiry_and_wrap(void){struct rig r;init(&r);uint32_t crc=gp_crc32(r.changed,208);CHECK(begin(&r,A,r.changed,crc,7,UINT32_MAX-1000)==0);CHECK(call(&r,0x20,NULL,0,1000,NULL)==0);CHECK(r.ctx.staging_active);CHECK(begin(&r,B,r.initial,gp_crc32(r.initial,208),7,3000)==GP_VENDOR_CONFLICT);CHECK(call(&r,0x20,NULL,0,4001,NULL)==0);CHECK(!r.ctx.staging_active);
 CHECK(begin(&r,B,r.initial,gp_crc32(r.initial,208),7,4010)==0);CHECK(write_part(&r,A,0,r.changed,40,4011)==GP_VENDOR_CONFLICT);CHECK(commit(&r,A,crc,7,4012)==GP_VENDOR_CONFLICT);CHECK(call(&r,0x24,A,8,4013,NULL)==GP_VENDOR_CONFLICT);CHECK(r.ctx.staging_active&&!memcmp(r.ctx.transaction,B,8));write_all(&r,B,r.initial,4020);CHECK(commit(&r,B,gp_crc32(r.initial,208),7,4300)==0);CHECK(r.ctx.revision==8);
 init(&r);CHECK(begin(&r,A,r.changed,crc,7,UINT32_MAX-1000)==0);CHECK(write_part(&r,A,0,r.changed,40,2500)==0);CHECK(call(&r,0x20,NULL,0,7000,NULL)==0);CHECK(r.ctx.staging_active);CHECK(call(&r,0x20,NULL,0,7501,NULL)==0);CHECK(!r.ctx.staging_active);unchanged(&r);
}
static uint32_t random_state=0xc1f9d102;static uint32_t rnd(void){random_state^=random_state<<13;random_state^=random_state>>17;random_state^=random_state<<5;return random_state;}
static void test_malformed_frames(void){struct rig r;init(&r);for(unsigned i=0;i<3000;++i){uint8_t p[54];for(unsigned j=0;j<54;++j)p[j]=(uint8_t)rnd();uint8_t command=(uint8_t)(0x20+rnd()%6),n=(uint8_t)rnd();uint8_t status=call(&r,command,p,n,i,NULL);CHECK(status<=GP_VENDOR_STORAGE);unchanged(&r);}CHECK(r.state.attempts==0);}
int main(void){test_alias_and_bounds();test_ownership_and_commit();test_crc_config_and_callback();test_expiry_and_wrap();test_malformed_frames();printf("AGP1 independent review: %u checks passed\n",checks);return 0;}
