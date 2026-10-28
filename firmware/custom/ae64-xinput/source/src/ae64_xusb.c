/* Original protocol backend. SPDX-License-Identifier: MIT
 * Wire-format facts checked against Keychron/qmk_firmware commit
 * 2b493ff95f2665db719b1e95c91babb5036e72f3 and Microsoft MS OS 1.0 docs.
 * No third-party USB identity, hardware addresses or USB-stack implementation.
 */
#include "ae64_xusb.h"

static void clear_bytes(void *memory, size_t length) {
    uint8_t *p=memory; for (size_t i=0;i<length;i++) p[i]=0;
}
static void copy_bytes(void *destination, const void *source, size_t length) {
    uint8_t *d=destination; const uint8_t *s=source;
    for (size_t i=0;i<length;i++) d[i]=s[i];
}

bool ae64_xusb_config_valid(const struct ae64_xusb_config *c) {
    return c && c->interface_number < 255u &&
        (c->endpoint_in & 0xF0u) == 0x80u && (c->endpoint_in & 15u) != 0u &&
        (c->endpoint_out & 0xF0u) == 0u && (c->endpoint_out & 15u) != 0u &&
        c->interval_in >= 1u && c->interval_in <= 16u &&
        c->interval_out >= 1u && c->interval_out <= 16u && c->ms_vendor_code != 0u;
}

bool ae64_xusb_init(struct ae64_xusb *x, const struct ae64_xusb_config *c,
                    const struct ae64_xusb_io *io) {
    if (!x || !ae64_xusb_config_valid(c) || !io || !io->start_in) return false;
    clear_bytes(x, sizeof(*x)); x->config=*c; x->io=*io; return true;
}

bool ae64_xusb_interface_descriptor(const struct ae64_xusb_config *c, uint8_t out[40]) {
    if (!out || !ae64_xusb_config_valid(c)) return false;
    /* Interface + XUSB-specific class descriptor + IN and OUT endpoints. */
    const uint8_t bytes[40] = {
        9,4,c->interface_number,0,2,0xFF,0x5D,1,0,
        17,0x21,0,1,1,0x25,c->endpoint_in,20,0,0,0,0,0x13,c->endpoint_out,8,0,0,
        7,5,c->endpoint_in,3,32,0,c->interval_in,
        7,5,c->endpoint_out,3,32,0,c->interval_out
    };
    copy_bytes(out, bytes, sizeof(bytes)); return true;
}

void ae64_xusb_device_descriptor(uint8_t out[18]) {
    if (!out) return;
    const uint8_t bytes[18]={18,1,0,2,0,0,0,64,0xA6,0x1C,0x0A,0x30,2,0,1,2,3,1};
    copy_bytes(out, bytes, sizeof(bytes));
}

bool ae64_xusb_ms_string(const struct ae64_xusb_config *c, uint8_t out[18]) {
    if (!out || !ae64_xusb_config_valid(c)) return false;
    const uint8_t bytes[18]={18,3,'M',0,'S',0,'F',0,'T',0,'1',0,'0',0,'0',0,c->ms_vendor_code,0};
    copy_bytes(out, bytes, sizeof(bytes)); return true;
}

bool ae64_xusb_ms_compatible_id(const struct ae64_xusb_config *c, uint8_t out[40]) {
    if (!out || !ae64_xusb_config_valid(c)) return false;
    clear_bytes(out,40); out[0]=40; out[5]=1; out[6]=4; out[8]=1;
    out[16]=c->interface_number; out[17]=1;
    copy_bytes(out+18,"XUSB10",6); return true;
}

bool ae64_xusb_control(const struct ae64_xusb *x, const struct ae64_usb_setup *s,
                       uint8_t *out, size_t capacity, size_t *length) {
    uint8_t descriptor[40]; size_t bytes;
    if (length) *length=0;
    if (!x || !s || !length || !ae64_xusb_config_valid(&x->config)) return false;
    if (s->request_type==0x80u && s->request==6u && s->value==0x03EEu &&
        (s->index==0u || s->index==0x0409u)) {
        if (!ae64_xusb_ms_string(&x->config,descriptor)) return false;
        bytes=18;
    } else if (s->request_type==0xC0u && s->request==x->config.ms_vendor_code &&
               s->value==0u && s->index==4u) {
        if (!ae64_xusb_ms_compatible_id(&x->config,descriptor)) return false;
        bytes=40;
    } else return false;
    if (bytes>s->length) bytes=s->length;
    if (capacity<bytes || (bytes && !out)) return false;
    if (bytes) copy_bytes(out,descriptor,bytes);
    *length=bytes; return true;
}

void ae64_xusb_encode_input(const struct gp_report *report, uint8_t out[20]) {
    if (!out) return;
    clear_bytes(out,20); out[1]=20;
    if (!report) return;
    /* Shared mapper already provides XInput button masks and signed-axis ordering. */
    gp_encode_xinput_state(report,out+2);
}

void ae64_xusb_configured(struct ae64_xusb *x, bool configured) {
    if (!x) return;
    /* Caller must have quiesced/cancelled the old transfer before clearing in_flight. */
    x->configured=configured; x->in_flight=false;
    clear_bytes(x->tx,sizeof(x->tx)); x->tx[1]=20;
}

bool ae64_xusb_submit(struct ae64_xusb *x, const struct gp_report *report) {
    if (!x || !report || !x->configured || x->in_flight || !x->io.start_in) return false;
    ae64_xusb_encode_input(report,x->tx);
    x->in_flight=true; /* Completion callback may run synchronously. */
    if (!x->io.start_in(x->io.user,x->config.endpoint_in,x->tx,sizeof(x->tx))) {
        x->in_flight=false; return false;
    }
    return true;
}

void ae64_xusb_in_complete(struct ae64_xusb *x, uint8_t endpoint) {
    if (x && endpoint==x->config.endpoint_in) x->in_flight=false;
}

bool ae64_xusb_out(struct ae64_xusb *x, uint8_t endpoint, const uint8_t *p, size_t n) {
    if (!x || !x->configured || endpoint!=x->config.endpoint_out || !p || n<2) return false;
    if (p[0]==0u && p[1]==8u && n==8u && p[2]==0u) {
        if (x->io.rumble) x->io.rumble(x->io.user,p[3],p[4]);
        return true;
    }
    if (p[0]==1u && p[1]==3u && n==3u) {
        if (x->io.led) x->io.led(x->io.user,p[2]);
        return true;
    }
    return false;
}
