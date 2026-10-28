/* Original example firmware logic. SPDX-License-Identifier: MIT */
#include "ae64_gamepad.h"

static void neutral(struct gp_report *r) { *r = (struct gp_report){0}; }
void gp_linear_curve(struct gp_curve *c) {
    if (!c) return;
    const uint16_t point[4] = {0, 3333, 6667, GP_TRAVEL_MAX};
    for (unsigned i=0; i<4; ++i) c->x[i] = c->y[i] = point[i];
}
void gp_config_empty(struct gp_config *c) {
    if (!c) return;
    *c = (struct gp_config){0}; c->revision=1; c->mode=GP_OFF;
    for (unsigned s=0; s<2; ++s) {
        c->stick[s].circular=true;
        struct gp_axis *axis[2]={&c->stick[s].x,&c->stick[s].y};
        for (unsigned a=0; a<2; ++a) {
            axis[a]->negative.key=axis[a]->positive.key=GP_NONE;
            axis[a]->negative.end=axis[a]->positive.end=GP_TRAVEL_MAX;
            gp_linear_curve(&axis[a]->negative.curve); gp_linear_curve(&axis[a]->positive.curve);
        }
        c->trigger[s].key=GP_NONE; c->trigger[s].end=GP_TRAVEL_MAX;
        gp_linear_curve(&c->trigger[s].curve);
    }
    for (unsigned i=0; i<GP_BUTTON_COUNT; ++i) c->button[i]=(struct gp_digital_key){GP_NONE,5000,3000};
    for (unsigned i=0; i<4; ++i) c->dpad[i]=(struct gp_digital_key){GP_NONE,5000,3000};
}
static bool key_valid(uint8_t k) { return k<GP_KEY_COUNT || k==GP_NONE; }
static bool curve_valid(const struct gp_curve *c) {
    if (c->x[0]!=0 || c->y[0]!=0 || c->x[3]!=GP_TRAVEL_MAX || c->y[3]!=GP_TRAVEL_MAX) return false;
    for (unsigned i=1; i<4; ++i)
        if (c->x[i]<=c->x[i-1] || c->y[i]<c->y[i-1] || c->y[i]>GP_TRAVEL_MAX) return false;
    return true;
}
static bool analog_valid(const struct gp_analog_key *k) {
    return key_valid(k->key) && k->start<k->end && k->end<=GP_TRAVEL_MAX && curve_valid(&k->curve);
}
static bool digital_valid(const struct gp_digital_key *k) {
    return key_valid(k->key) && k->press>k->release && k->press<=GP_TRAVEL_MAX;
}
bool gp_config_valid(const struct gp_config *c) {
    if (!c || c->mode<GP_OFF || c->mode>GP_MIXED) return false;
    for (unsigned s=0; s<2; ++s) {
        const struct gp_stick *k=&c->stick[s];
        if (k->radial_deadzone>=GP_TRAVEL_MAX || (!k->circular && k->radial_deadzone)) return false;
        const struct gp_axis *a[2]={&k->x,&k->y};
        for (unsigned j=0; j<2; ++j)
            if (a[j]->opposition<GP_DEPTH_DIFFERENCE || a[j]->opposition>GP_DEEPER_WINS ||
                !analog_valid(&a[j]->negative) || !analog_valid(&a[j]->positive)) return false;
        if (!analog_valid(&c->trigger[s])) return false;
    }
    for (unsigned i=0; i<GP_BUTTON_COUNT; ++i) if (!digital_valid(&c->button[i])) return false;
    for (unsigned i=0; i<4; ++i) if (!digital_valid(&c->dpad[i])) return false;
    return true;
}
void gp_reset(struct gp_context *c) { if (c) { *c=(struct gp_context){0}; c->needs_release=true; } }
static uint64_t key_bit(uint8_t key) { return key<GP_KEY_COUNT ? (UINT64_C(1)<<key) : 0; }
uint64_t gp_bound_keys(const struct gp_config *c) {
    if (!gp_config_valid(c)) return 0;
    uint64_t mask=0;
    for (unsigned s=0; s<2; ++s) {
        const struct gp_axis *a[2]={&c->stick[s].x,&c->stick[s].y};
        for (unsigned j=0; j<2; ++j) mask |= key_bit(a[j]->negative.key)|key_bit(a[j]->positive.key);
        mask |= key_bit(c->trigger[s].key);
    }
    for (unsigned i=0; i<GP_BUTTON_COUNT; ++i) mask |= key_bit(c->button[i].key);
    for (unsigned i=0; i<4; ++i) mask |= key_bit(c->dpad[i].key);
    return mask;
}
uint64_t gp_keyboard_suppression(const struct gp_config *c) {
    return c && c->mode==GP_CONTROLLER_ONLY ? gp_bound_keys(c) : 0;
}
static uint16_t depth(const uint16_t *travel, uint8_t key) {
    if (key==GP_NONE) return 0;
    return travel[key]>GP_TRAVEL_MAX ? GP_TRAVEL_MAX : travel[key];
}
static uint16_t analog(const struct gp_analog_key *k,const uint16_t *travel) {
    if (k->key==GP_NONE) return 0;
    uint16_t d=depth(travel,k->key);
    if (d<=k->start) return 0;
    if (d>=k->end) return GP_TRAVEL_MAX;
    uint32_t x=(uint32_t)(d-k->start)*GP_TRAVEL_MAX/(k->end-k->start);
    for (unsigned i=1; i<4; ++i) if (x<=k->curve.x[i])
        return (uint16_t)(k->curve.y[i-1]+(x-k->curve.x[i-1])*
            (k->curve.y[i]-k->curve.y[i-1])/(k->curve.x[i]-k->curve.x[i-1]));
    return GP_TRAVEL_MAX;
}
static int32_t axis_value(const struct gp_axis *axis,const uint16_t *travel) {
    int32_t n=analog(&axis->negative,travel),p=analog(&axis->positive,travel);
    if (axis->opposition==GP_NEUTRAL_ON_BOTH && n && p) return 0;
    if (axis->opposition==GP_DEEPER_WINS) return p==n ? 0 : (p>n ? p : -n);
    return p-n;
}
static uint32_t sqrt_floor(uint32_t n) {
    uint32_t result=0,bit=UINT32_C(1)<<30;
    while (bit>n) bit>>=2;
    while (bit) {
        if (n>=result+bit) { n-=result+bit; result=(result>>1)+bit; }
        else result>>=1;
        bit>>=2;
    }
    return result;
}
static int16_t signed_axis(int32_t value) {
    return (int16_t)(value>=0 ? value*32767/10000 : value*32768/10000);
}
static void stick(const struct gp_stick *config,const uint16_t *travel,int16_t *ox,int16_t *oy) {
    int32_t x=axis_value(&config->x,travel),y=axis_value(&config->y,travel);
    if (config->circular) {
        uint32_t squared=(uint32_t)(x*x)+(uint32_t)(y*y),r=sqrt_floor(squared);
        if (r*r<squared) ++r;
        if (r<=config->radial_deadzone) { *ox=0;*oy=0;return; }
        uint32_t clamped=r>GP_TRAVEL_MAX ? GP_TRAVEL_MAX : r;
        uint32_t scaled=(clamped-config->radial_deadzone)*GP_TRAVEL_MAX/
                        (GP_TRAVEL_MAX-config->radial_deadzone);
        x=x*(int32_t)scaled/(int32_t)r; y=y*(int32_t)scaled/(int32_t)r;
    }
    *ox=signed_axis(x); *oy=signed_axis(y);
}
static bool ready_to_arm(const struct gp_config *c,const uint16_t *travel) {
    for (unsigned s=0; s<2; ++s) {
        const struct gp_axis *a[2]={&c->stick[s].x,&c->stick[s].y};
        for (unsigned j=0; j<2; ++j)
            if (depth(travel,a[j]->negative.key)>a[j]->negative.start ||
                depth(travel,a[j]->positive.key)>a[j]->positive.start) return false;
        if (depth(travel,c->trigger[s].key)>c->trigger[s].start) return false;
    }
    for (unsigned i=0; i<GP_BUTTON_COUNT; ++i) if (depth(travel,c->button[i].key)>c->button[i].release) return false;
    for (unsigned i=0; i<4; ++i) if (depth(travel,c->dpad[i].key)>c->dpad[i].release) return false;
    return true;
}
static bool digital(const struct gp_digital_key *binding,const uint16_t *travel,bool previous) {
    if (binding->key==GP_NONE) return false;
    uint16_t value=depth(travel,binding->key);
    return previous ? value>binding->release : value>=binding->press;
}
bool gp_update(struct gp_context *ctx,const struct gp_config *cfg,const uint16_t travel[GP_KEY_COUNT],
               uint64_t valid,uint32_t now,struct gp_report *out) {
    if (!out) return false;
    neutral(out);
    if (!ctx) return false;
    if (!gp_config_valid(cfg) || !travel) { gp_reset(ctx);return false; }
    if (!ctx->configured || ctx->revision!=cfg->revision || ctx->mode!=cfg->mode) {
        gp_reset(ctx);ctx->configured=true;ctx->revision=cfg->revision;ctx->mode=cfg->mode;
    }
    ctx->last_frame_ms=now;ctx->has_frame=true;
    if (cfg->mode==GP_OFF) { neutral(&ctx->report);ctx->needs_release=true;return true; }
    if (gp_bound_keys(cfg)&~valid) { gp_reset(ctx);return false; }
    if (ctx->needs_release) {
        if (ready_to_arm(cfg,travel)) ctx->needs_release=false;
        neutral(&ctx->report);return true;
    }
    stick(&cfg->stick[0],travel,&out->lx,&out->ly);
    stick(&cfg->stick[1],travel,&out->rx,&out->ry);
    out->lt=(uint8_t)((uint32_t)analog(&cfg->trigger[0],travel)*255/10000);
    out->rt=(uint8_t)((uint32_t)analog(&cfg->trigger[1],travel)*255/10000);
    for (unsigned i=0; i<GP_BUTTON_COUNT; ++i)
        if (digital(&cfg->button[i],travel,(ctx->button_latches&(1u<<i))!=0)) out->buttons |= (uint16_t)(1u<<i);
    uint8_t held=0;
    for (unsigned i=0; i<4; ++i)
        if (digital(&cfg->dpad[i],travel,(ctx->dpad_latches&(1u<<i))!=0)) held |= (uint8_t)(1u<<i);
    ctx->button_latches=out->buttons;ctx->dpad_latches=held;out->dpad=held;
    if ((held&3u)==3u) out->dpad &= (uint8_t)~3u;
    if ((held&12u)==12u) out->dpad &= (uint8_t)~12u;
    ctx->report=*out;return true;
}
bool gp_watchdog(struct gp_context *ctx,uint32_t now,uint32_t age,struct gp_report *out) {
    if (!ctx || !out || !ctx->has_frame || (uint32_t)(now-ctx->last_frame_ms)<=age) return false;
    neutral(out);neutral(&ctx->report);ctx->button_latches=0;ctx->dpad_latches=0;
    ctx->needs_release=true;ctx->has_frame=false;return true;
}
bool gp_report_equal(const struct gp_report *a,const struct gp_report *b) {
    return a && b && a->lx==b->lx && a->ly==b->ly && a->rx==b->rx && a->ry==b->ry &&
        a->lt==b->lt && a->rt==b->rt && a->buttons==b->buttons && a->dpad==b->dpad;
}
static void le16(uint8_t *dst,uint16_t value) { dst[0]=(uint8_t)value;dst[1]=(uint8_t)(value>>8); }
static uint8_t hat(uint8_t d) {
    bool u=(d&1)!=0,dn=(d&2)!=0,l=(d&4)!=0,r=(d&8)!=0;
    if (u&&dn) u=dn=false;
    if (l&&r) l=r=false;
    if (u) return r ? 1 : (l ? 7 : 0);
    if (dn) return r ? 3 : (l ? 5 : 4);
    return r ? 2 : (l ? 6 : 8);
}
static int16_t invert_y(int16_t v) { return v==INT16_MIN ? INT16_MAX : (int16_t)-v; }
void gp_encode_hid(const struct gp_report *r,uint8_t out[GP_HID_REPORT_BYTES]) {
    if (!r || !out) return;
    out[0]=GP_HID_REPORT_ID;le16(out+1,r->buttons&0x03ffu);out[3]=hat(r->dpad);
    le16(out+4,(uint16_t)r->lx);le16(out+6,(uint16_t)invert_y(r->ly));
    le16(out+8,(uint16_t)r->rx);le16(out+10,(uint16_t)invert_y(r->ry));out[12]=r->lt;out[13]=r->rt;
}
void gp_encode_xinput_state(const struct gp_report *r,uint8_t out[12]) {
    if (!r || !out) return;
    const uint16_t masks[GP_BUTTON_COUNT]={0x1000,0x2000,0x4000,0x8000,0x0100,0x0200,0x0020,0x0010,0x0040,0x0080};
    uint16_t buttons=0;
    for (unsigned i=0; i<GP_BUTTON_COUNT; ++i) if (r->buttons&(1u<<i)) buttons |= masks[i];
    uint8_t d=r->dpad;
    if ((d&3u)==3u) d &= (uint8_t)~3u;
    if ((d&12u)==12u) d &= (uint8_t)~12u;
    buttons |= d&15u;
    le16(out,buttons);out[2]=r->lt;out[3]=r->rt;
    le16(out+4,(uint16_t)r->lx);le16(out+6,(uint16_t)r->ly);
    le16(out+8,(uint16_t)r->rx);le16(out+10,(uint16_t)r->ry);
}

/* Separate Generic Desktop Game Pad application collection. The board port must
 * supply an actual interface/endpoint and USB request handling. No XInput claim.
 */
const uint8_t gp_hid_report_descriptor[]={
    0x05,0x01,0x09,0x05,0xA1,0x01,0x85,GP_HID_REPORT_ID,
    0x05,0x09,0x19,0x01,0x29,0x10,0x15,0x00,0x25,0x01,0x75,0x01,0x95,0x10,0x81,0x02,
    0x05,0x01,0x09,0x39,0x15,0x00,0x25,0x07,0x35,0x00,0x46,0x3B,0x01,
    0x65,0x14,0x75,0x04,0x95,0x01,0x81,0x42,0x65,0x00,0x35,0x00,0x45,0x00,
    0x75,0x04,0x95,0x01,0x81,0x03,
    0x09,0x30,0x09,0x31,0x09,0x33,0x09,0x34,0x16,0x00,0x80,0x26,0xFF,0x7F,
    0x75,0x10,0x95,0x04,0x81,0x02,
    0x09,0x32,0x09,0x35,0x15,0x00,0x26,0xFF,0x00,0x75,0x08,0x95,0x02,0x81,0x02,0xC0
};
const size_t gp_hid_report_descriptor_size=sizeof gp_hid_report_descriptor;
