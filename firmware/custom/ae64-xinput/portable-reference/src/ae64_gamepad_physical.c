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
bool gp_physical_watchdog(struct gp_physical_context *context,uint32_t now,uint32_t age,
                          struct gp_report *output) {
    if (!context || !output || !context->has_frame || (uint32_t)(now-context->last_frame_ms)<=age)return false;
    neutral(output);neutral(&context->report);gp_reset(&context->analog);
    context->needs_release=true;context->has_frame=false;return true;
}
