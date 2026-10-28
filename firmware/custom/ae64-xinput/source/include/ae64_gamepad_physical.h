/* Original physical-distance and stock-key-event adapter. SPDX-License-Identifier: MIT */
#ifndef AE64_GAMEPAD_PHYSICAL_H
#define AE64_GAMEPAD_PHYSICAL_H
#include "ae64_gamepad.h"

#define GP_PHYSICAL_MIN_STROKE_UM 10u
#define GP_PHYSICAL_MAX_STROKE_UM 10000u

struct gp_physical_analog_key {
    uint8_t key;
    uint16_t start_um, end_um; /* e.g. 1000..3000 means 1..3 millimeters */
    struct gp_curve curve; /* fractional input/output knots 0..10000 */
};
struct gp_physical_axis {
    struct gp_physical_analog_key negative, positive;
    enum gp_opposition opposition;
};
struct gp_physical_stick {
    struct gp_physical_axis x, y;
    uint16_t radial_deadzone; /* normalized radial output fraction, 0..9999 */
    bool circular;
};
struct gp_physical_config {
    uint32_t revision; /* increment for every atomic mapping/settings edit */
    enum gp_mode mode;
    struct gp_physical_stick stick[2];
    struct gp_physical_analog_key trigger[2];
    uint8_t button[GP_BUTTON_COUNT]; /* physical key indices or GP_NONE */
    uint8_t dpad[4]; /* enum gp_direction order; exclusively stock pressed state */
};
struct gp_physical_frame {
    const uint16_t *travel_um; /* GP_KEY_COUNT calibrated physical distances */
    const uint16_t *max_travel_um; /* GP_KEY_COUNT measured full strokes */
    uint64_t valid_mask; /* valid calibration/frame data for every bound key */
    uint64_t stock_pressed; /* canonical keyboard pressed/RT state, never inferred here */
    bool stock_pressed_valid; /* required when any button/D-pad key is mapped */
    uint32_t now_ms;
};
struct gp_physical_context {
    struct gp_context analog;
    uint32_t revision, last_frame_ms;
    enum gp_mode mode;
    bool configured, needs_release, has_frame;
    uint64_t bound_mask;
    uint16_t max_travel_um[GP_KEY_COUNT];
    struct gp_report report;
};

void gp_physical_config_empty(struct gp_physical_config *config);
bool gp_physical_config_valid(const struct gp_physical_config *config,
                              const uint16_t max_travel_um[GP_KEY_COUNT]);
uint64_t gp_physical_bound_keys(const struct gp_physical_config *config,
                                const uint16_t max_travel_um[GP_KEY_COUNT]);
uint64_t gp_physical_keyboard_suppression(const struct gp_physical_config *config,
                                        const uint16_t max_travel_um[GP_KEY_COUNT]);
void gp_physical_reset(struct gp_physical_context *context);
/* Duplicate mappings are allowed: one key may drive multiple controls.
 * Digital controls consume only stock_pressed; no second actuation threshold.
 * Faults, mode/revision/calibration changes and watchdog expiry produce neutral
 * output and require analog keys <= start_um plus all mapped digital keys up.
 * The release frame itself remains neutral. No USB/device operations occur.
 */
bool gp_physical_update(struct gp_physical_context *context,
                        const struct gp_physical_config *config,
                        const struct gp_physical_frame *frame,
                        struct gp_report *output);
bool gp_physical_watchdog(struct gp_physical_context *context, uint32_t now_ms,
                          uint32_t max_age_ms, struct gp_report *output);
#endif
