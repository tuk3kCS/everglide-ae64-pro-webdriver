/* Original example firmware logic. SPDX-License-Identifier: MIT */
#ifndef AE64_GAMEPAD_H
#define AE64_GAMEPAD_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define GP_KEY_COUNT 64u
#define GP_NONE 255u
#define GP_TRAVEL_MAX 10000u
#define GP_BUTTON_COUNT 10u
#define GP_HID_REPORT_ID 5u
#define GP_HID_REPORT_BYTES 14u

enum gp_mode { GP_OFF, GP_CONTROLLER_ONLY, GP_MIXED };
enum gp_opposition { GP_DEPTH_DIFFERENCE, GP_NEUTRAL_ON_BOTH, GP_DEEPER_WINS };
enum gp_button { GP_A, GP_B, GP_X, GP_Y, GP_LB, GP_RB, GP_BACK, GP_START, GP_L3, GP_R3 };
enum gp_direction { GP_UP, GP_DOWN, GP_LEFT, GP_RIGHT };

struct gp_curve { uint16_t x[4]; uint16_t y[4]; };
struct gp_analog_key {
    uint8_t key;
    uint16_t start, end;
    struct gp_curve curve;
};
struct gp_axis { struct gp_analog_key negative, positive; enum gp_opposition opposition; };
struct gp_stick {
    struct gp_axis x, y; /* positive Y means up, matching XINPUT_GAMEPAD */
    uint16_t radial_deadzone;
    bool circular; /* square mode requires radial_deadzone == 0 */
};
struct gp_digital_key { uint8_t key; uint16_t press, release; };
struct gp_config {
    uint32_t revision; /* increment after any mapping/settings edit */
    enum gp_mode mode;
    struct gp_stick stick[2];
    struct gp_analog_key trigger[2];
    struct gp_digital_key button[GP_BUTTON_COUNT];
    struct gp_digital_key dpad[4];
};
struct gp_report {
    int16_t lx, ly, rx, ry;
    uint8_t lt, rt;
    uint16_t buttons; /* bits follow enum gp_button, not XInput's masks */
    uint8_t dpad; /* UP/DOWN/LEFT/RIGHT bits; opposing pairs cancel */
};
struct gp_context {
    uint32_t revision, last_frame_ms;
    enum gp_mode mode;
    bool configured, needs_release, has_frame;
    uint16_t button_latches;
    uint8_t dpad_latches;
    struct gp_report report;
};

void gp_linear_curve(struct gp_curve *curve);
void gp_config_empty(struct gp_config *config);
bool gp_config_valid(const struct gp_config *config);
void gp_reset(struct gp_context *context);
uint64_t gp_bound_keys(const struct gp_config *config);
uint64_t gp_keyboard_suppression(const struct gp_config *config);
/* Invalid/incomplete frames produce a neutral report and require release before rearming.
 * travel is normalized calibrated depth, never raw ADC or assumed millimeters.
 * valid_mask must cover every bound key. Mapping/profile changes require revision++.
 */
bool gp_update(struct gp_context *context, const struct gp_config *config,
               const uint16_t travel[GP_KEY_COUNT], uint64_t valid_mask,
               uint32_t now_ms, struct gp_report *output);
/* Call even when no scan frame arrives. True means output was neutralized. */
bool gp_watchdog(struct gp_context *context, uint32_t now_ms, uint32_t max_age_ms,
                 struct gp_report *output);
bool gp_report_equal(const struct gp_report *a, const struct gp_report *b);
/* Generic HID only. 14 bytes includes Report ID 5. Positive Y is inverted for HID. */
void gp_encode_hid(const struct gp_report *report, uint8_t output[GP_HID_REPORT_BYTES]);
extern const uint8_t gp_hid_report_descriptor[];
extern const size_t gp_hid_report_descriptor_size;
/* Serialization of Microsoft's 12-byte XINPUT_GAMEPAD field layout, not a USB backend. */
void gp_encode_xinput_state(const struct gp_report *report, uint8_t output[12]);
#endif
