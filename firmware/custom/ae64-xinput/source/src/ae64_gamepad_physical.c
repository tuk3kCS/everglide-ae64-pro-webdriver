/* Original physical-distance and stock-key-event adapter. SPDX-License-Identifier: MIT */
#include "ae64_gamepad_physical.h"

static uint64_t bit(uint8_t key) { return key<GP_KEY_COUNT ? UINT64_C(1)<<key : 0; }
static bool key_valid(uint8_t key) { return key<GP_KEY_COUNT || key==GP_NONE; }
static void neutral(struct gp_report *r) { *r=(struct gp_report){0}; }
static uint16_t normalize(uint16_t um,uint16_t maximum) {
    return (uint16_t)((uint32_t)um*GP_TRAVEL_MAX/maximum);
}
static void analog_empty(struct gp_physical_analog_key *key) {
    key->key=GP_NONE;key->start_um=0;key->end_um=1000;gp_linear_curve(&key->curve);
}
void gp_physical_config_empty(struct gp_physical_config *c) {
    if (!c) return;
    *c=(struct gp_physical_config){0};c->revision=1;c->mode=GP_OFF;
    for (unsigned s=0;s<2;++s) {
        c->stick[s].circular=true;
        analog_empty(&c->stick[s].x.negative);analog_empty(&c->stick[s].x.positive);
        analog_empty(&c->stick[s].y.negative);analog_empty(&c->stick[s].y.positive);
        analog_empty(&c->trigger[s]);
    }
    for (unsigned i=0;i<GP_BUTTON_COUNT;++i)c->button[i]=GP_NONE;
    for (unsigned i=0;i<4;++i)c->dpad[i]=GP_NONE;
}
static bool copy_analog(const struct gp_physical_analog_key *source,
                        const uint16_t *maximum,struct gp_analog_key *target,
                        uint64_t *bound) {
    if (!key_valid(source->key) || source->start_um>=source->end_um ||
        source->end_um>GP_PHYSICAL_MAX_STROKE_UM) return false;
    target->key=source->key;target->curve=source->curve;
    if (source->key==GP_NONE) { target->start=0;target->end=GP_TRAVEL_MAX;return true; }
    if (!maximum || maximum[source->key]<GP_PHYSICAL_MIN_STROKE_UM ||
        maximum[source->key]>GP_PHYSICAL_MAX_STROKE_UM ||
        source->end_um>maximum[source->key]) return false;
    target->start=normalize(source->start_um,maximum[source->key]);
    target->end=normalize(source->end_um,maximum[source->key]);
    *bound |= bit(source->key);
    return true;
}
static bool make_core(const struct gp_physical_config *source,const uint16_t *maximum,
                       struct gp_config *target,uint64_t *bound,uint64_t *digital) {
    if (!source) return false;
    gp_config_empty(target);target->revision=source->revision;target->mode=source->mode;
    *bound=0;*digital=0;
    for (unsigned s=0;s<2;++s) {
        target->stick[s].radial_deadzone=source->stick[s].radial_deadzone;
        target->stick[s].circular=source->stick[s].circular;
        const struct gp_physical_axis *from[2]={&source->stick[s].x,&source->stick[s].y};
        struct gp_axis *to[2]={&target->stick[s].x,&target->stick[s].y};
        for (unsigned a=0;a<2;++a) {
            to[a]->opposition=from[a]->opposition;
            if (!copy_analog(&from[a]->negative,maximum,&to[a]->negative,bound) ||
                !copy_analog(&from[a]->positive,maximum,&to[a]->positive,bound)) return false;
        }
        if (!copy_analog(&source->trigger[s],maximum,&target->trigger[s],bound)) return false;
    }
    for (unsigned i=0;i<GP_BUTTON_COUNT;++i) {
        if (!key_valid(source->button[i])) return false;
        *digital |= bit(source->button[i]);
    }
    for (unsigned i=0;i<4;++i) {
        if (!key_valid(source->dpad[i])) return false;
        *digital |= bit(source->dpad[i]);
    }
    *bound |= *digital;
    for (unsigned key=0;key<GP_KEY_COUNT;++key) if (*bound & bit((uint8_t)key))
        if (!maximum || maximum[key]<GP_PHYSICAL_MIN_STROKE_UM ||
            maximum[key]>GP_PHYSICAL_MAX_STROKE_UM) return false;
    /* Core digital bindings remain GP_NONE: pressed/RT events are applied later. */
    return gp_config_valid(target);
}
bool gp_physical_config_valid(const struct gp_physical_config *config,const uint16_t *maximum) {
    struct gp_config core;uint64_t bound,digital;
    return make_core(config,maximum,&core,&bound,&digital);
}
uint64_t gp_physical_bound_keys(const struct gp_physical_config *config,const uint16_t *maximum) {
    struct gp_config core;uint64_t bound,digital;
    return make_core(config,maximum,&core,&bound,&digital) ? bound : 0;
}
uint64_t gp_physical_keyboard_suppression(const struct gp_physical_config *config,const uint16_t *maximum) {
    return config && config->mode==GP_CONTROLLER_ONLY ? gp_physical_bound_keys(config,maximum) : 0;
}
void gp_physical_reset(struct gp_physical_context *context) {
    if (!context)return;
    *context=(struct gp_physical_context){0};gp_reset(&context->analog);context->needs_release=true;
}
static bool calibration_changed(const struct gp_physical_context *context,
                                 uint64_t bound,const uint16_t *maximum) {
    if (context->bound_mask!=bound)return true;
    for (unsigned key=0;key<GP_KEY_COUNT;++key)
        if ((bound&bit((uint8_t)key)) && context->max_travel_um[key]!=maximum[key])return true;
    return false;
}
static bool analog_released(const struct gp_physical_analog_key *binding,const uint16_t *travel) {
    return binding->key==GP_NONE || travel[binding->key]<=binding->start_um;
}
static bool released(const struct gp_physical_config *config,const uint16_t *travel,
                      uint64_t digital,uint64_t pressed) {
    if (digital&pressed)return false;
    for (unsigned s=0;s<2;++s) {
        const struct gp_physical_axis *axis[2]={&config->stick[s].x,&config->stick[s].y};
        for (unsigned a=0;a<2;++a)
            if (!analog_released(&axis[a]->negative,travel) ||
                !analog_released(&axis[a]->positive,travel)) return false;
        if (!analog_released(&config->trigger[s],travel))return false;
    }
    return true;
}
static void digital_report(const struct gp_physical_config *config,uint64_t pressed,
                            struct gp_report *report) {
    for (unsigned i=0;i<GP_BUTTON_COUNT;++i)
        if (pressed&bit(config->button[i]))report->buttons |= (uint16_t)(1u<<i);
    for (unsigned i=0;i<4;++i)
        if (pressed&bit(config->dpad[i]))report->dpad |= (uint8_t)(1u<<i);
    if ((report->dpad&3u)==3u)report->dpad &= (uint8_t)~3u;
    if ((report->dpad&12u)==12u)report->dpad &= (uint8_t)~12u;
}
bool gp_physical_update(struct gp_physical_context *context,
                        const struct gp_physical_config *config,
                        const struct gp_physical_frame *frame,struct gp_report *output) {
    if (!output)return false;
    neutral(output);
    if (!context)return false;
    struct gp_config core;uint64_t bound,digital;
    if (!frame || !make_core(config,frame->max_travel_um,&core,&bound,&digital)) {
        gp_physical_reset(context);return false;
    }
    if (!context->configured || context->revision!=config->revision || context->mode!=config->mode ||
        calibration_changed(context,bound,frame->max_travel_um)) {
        gp_physical_reset(context);context->configured=true;context->revision=config->revision;
        context->mode=config->mode;context->bound_mask=bound;
        for (unsigned key=0;key<GP_KEY_COUNT;++key)
            if (bound&bit((uint8_t)key))context->max_travel_um[key]=frame->max_travel_um[key];
    }
    if (config->mode==GP_OFF) {
        context->last_frame_ms=frame->now_ms;context->has_frame=true;
        context->needs_release=true;neutral(&context->report);gp_reset(&context->analog);return true;
    }
    if ((bound && !frame->travel_um) || (bound&~frame->valid_mask) ||
        (digital && !frame->stock_pressed_valid)) {
        gp_physical_reset(context);return false;
    }
    uint16_t normalized[GP_KEY_COUNT]={0};
    for (unsigned key=0;key<GP_KEY_COUNT;++key) if (bound&bit((uint8_t)key)) {
        if (frame->travel_um[key]>frame->max_travel_um[key]) {
            gp_physical_reset(context);return false;
        }
        normalized[key]=normalize(frame->travel_um[key],frame->max_travel_um[key]);
    }
    context->last_frame_ms=frame->now_ms;context->has_frame=true;
    if (context->needs_release) {
        if (released(config,frame->travel_um,digital,frame->stock_pressed)) {
            struct gp_report ignored;
            if (!gp_update(&context->analog,&core,normalized,frame->valid_mask,frame->now_ms,&ignored)) {
                gp_physical_reset(context);return false;
            }
            context->needs_release=false;
        }
        neutral(&context->report);return true;
    }
    if (!gp_update(&context->analog,&core,normalized,frame->valid_mask,frame->now_ms,output)) {
        gp_physical_reset(context);neutral(output);return false;
    }
    digital_report(config,frame->stock_pressed,output);context->report=*output;return true;
}
/* Iterate only the mapped keys without a target-specific bit-scan intrinsic. */
static uint8_t take_key(uint64_t *mask) {
    uint32_t low=(uint32_t)*mask;uint8_t key=0;
    if (!low) { low=(uint32_t)(*mask>>32);key=32; }
    if (!(low&0xffffu)) { low>>=16;key+=16; }
    if (!(low&0xffu)) { low>>=8;key+=8; }
    if (!(low&0xfu)) { low>>=4;key+=4; }
    if (!(low&3u)) { low>>=2;key+=2; }
    if (!(low&1u))key++;
    *mask &= *mask-UINT64_C(1);return key;
}
static bool cached_maximum_changed(const struct gp_physical_context *context,
                                    const uint16_t *maximum) {
    uint64_t pending=context->bound_mask;
    if (!maximum)return pending!=0;
    while (pending) {
        uint8_t key=take_key(&pending);
        if (context->max_travel_um[key]!=maximum[key])return true;
    }
    return false;
}
static bool prepare_cache(struct gp_physical_context *context,
                           const struct gp_physical_config *config,
                           const uint16_t *maximum) {
    if (context->configured && context->validated_config_identity==(uintptr_t)config &&
        context->revision==config->revision && context->mode==config->mode &&
        !cached_maximum_changed(context,maximum))return true;
    struct gp_config core;uint64_t bound,digital;
    if (!make_core(config,maximum,&core,&bound,&digital))return false;
    if (!context->configured || context->revision!=config->revision ||
        context->mode!=config->mode || calibration_changed(context,bound,maximum)) {
        gp_physical_reset(context);context->configured=true;
        context->revision=config->revision;context->mode=config->mode;context->bound_mask=bound;
        uint64_t pending=bound;
        while (pending) { uint8_t key=take_key(&pending);context->max_travel_um[key]=maximum[key]; }
    }
    for (unsigned s=0;s<2;++s) {
        const struct gp_axis *axis[2]={&core.stick[s].x,&core.stick[s].y};
        for (unsigned a=0;a<2;++a) {
            unsigned i=s*5u+a*2u;
            context->analog_start[i]=axis[a]->negative.start;context->analog_end[i]=axis[a]->negative.end;
            context->analog_start[i+1]=axis[a]->positive.start;context->analog_end[i+1]=axis[a]->positive.end;
        }
        context->analog_start[s*5u+4]=core.trigger[s].start;
        context->analog_end[s*5u+4]=core.trigger[s].end;
    }
    context->digital_mask=digital;context->validated_config_identity=(uintptr_t)config;return true;
}
static uint16_t cached_level(const struct gp_physical_context *context,
                              const struct gp_physical_analog_key *binding,
                              unsigned index,const uint16_t *normalized) {
    if (binding->key==GP_NONE)return 0;
    return gp_curve_level_validated(normalized[binding->key],context->analog_start[index],
                                     context->analog_end[index],&binding->curve);
}
static int32_t cached_axis(const struct gp_physical_context *context,
                            const struct gp_physical_axis *axis,unsigned index,
                            const uint16_t *normalized) {
    int32_t n=cached_level(context,&axis->negative,index,normalized),
            p=cached_level(context,&axis->positive,index+1,normalized);
    if (axis->opposition==GP_NEUTRAL_ON_BOTH && n && p)return 0;
    if (axis->opposition==GP_DEEPER_WINS)return p==n ? 0 : (p>n ? p : -n);
    return p-n;
}
static bool cached_ready(const struct gp_physical_context *context,
                           const struct gp_physical_config *config,
                           const uint16_t *normalized) {
    for (unsigned s=0;s<2;++s) {
        const struct gp_physical_axis *axis[2]={&config->stick[s].x,&config->stick[s].y};
        for (unsigned a=0;a<2;++a) {
            unsigned i=s*5u+a*2u;uint8_t n=axis[a]->negative.key,p=axis[a]->positive.key;
            if ((n!=GP_NONE && normalized[n]>context->analog_start[i]) ||
                (p!=GP_NONE && normalized[p]>context->analog_start[i+1]))return false;
        }
        uint8_t key=config->trigger[s].key;
        if (key!=GP_NONE && normalized[key]>context->analog_start[s*5u+4])return false;
    }
    return true;
}
/* The physical validator has covered every core analog key and its valid bit.
 * Core digital bindings are always GP_NONE; stock events are merged afterwards.
 */
static void cached_analog_update(struct gp_physical_context *context,
                                  const struct gp_physical_config *config,
                                  const uint16_t *normalized,uint32_t now,
                                  struct gp_report *output) {
    struct gp_context *analog=&context->analog;neutral(output);
    if (!analog->configured || analog->revision!=config->revision || analog->mode!=config->mode) {
        gp_reset(analog);analog->configured=true;analog->revision=config->revision;analog->mode=config->mode;
    }
    analog->last_frame_ms=now;analog->has_frame=true;
    if (analog->needs_release) {
        if (cached_ready(context,config,normalized))analog->needs_release=false;
        neutral(&analog->report);return;
    }
    int16_t *ox[2]={&output->lx,&output->rx},*oy[2]={&output->ly,&output->ry};
    uint8_t *trigger[2]={&output->lt,&output->rt};
    for (unsigned s=0;s<2;++s) {
        gp_stick_axes_validated(cached_axis(context,&config->stick[s].x,s*5u,normalized),
                                cached_axis(context,&config->stick[s].y,s*5u+2,normalized),
                                config->stick[s].radial_deadzone,config->stick[s].circular,ox[s],oy[s]);
        *trigger[s]=(uint8_t)((uint32_t)cached_level(context,&config->trigger[s],s*5u+4,normalized)*255/10000);
    }
    analog->button_latches=0;analog->dpad_latches=0;analog->report=*output;
}
bool gp_physical_update_cached(struct gp_physical_context *context,
                               const struct gp_physical_config *config,
                               const struct gp_physical_frame *frame,
                               struct gp_report *output) {
    if (!output)return false;
    neutral(output);
    if (!context)return false;
    if (!frame || !config || !prepare_cache(context,config,frame->max_travel_um)) {
        gp_physical_reset(context);return false;
    }
    if (config->mode==GP_OFF) {
        context->last_frame_ms=frame->now_ms;context->has_frame=true;
        context->needs_release=true;neutral(&context->report);gp_reset(&context->analog);return true;
    }
    uint64_t bound=context->bound_mask,digital=context->digital_mask;
    if ((bound && !frame->travel_um) || (bound&~frame->valid_mask) ||
        (digital && !frame->stock_pressed_valid)) {
        gp_physical_reset(context);return false;
    }
    /* Only mapped entries can be read by the validated evaluator. */
    uint16_t normalized[GP_KEY_COUNT];uint64_t pending=bound;
    while (pending) {
        uint8_t key=take_key(&pending);
        if (frame->travel_um[key]>frame->max_travel_um[key]) {
            gp_physical_reset(context);return false;
        }
        normalized[key]=normalize(frame->travel_um[key],frame->max_travel_um[key]);
    }
    context->last_frame_ms=frame->now_ms;context->has_frame=true;
    if (context->needs_release) {
        if (released(config,frame->travel_um,digital,frame->stock_pressed)) {
            struct gp_report ignored;cached_analog_update(context,config,normalized,frame->now_ms,&ignored);
            context->needs_release=false;
        }
        neutral(&context->report);return true;
    }
    cached_analog_update(context,config,normalized,frame->now_ms,output);
    digital_report(config,frame->stock_pressed,output);context->report=*output;return true;
}
bool gp_physical_watchdog(struct gp_physical_context *context,uint32_t now,uint32_t age,
                          struct gp_report *output) {
    if (!context || !output || !context->has_frame || (uint32_t)(now-context->last_frame_ms)<=age)return false;
    neutral(output);neutral(&context->report);gp_reset(&context->analog);
    context->needs_release=true;context->has_frame=false;return true;
}
