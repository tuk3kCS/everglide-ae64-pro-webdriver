/* Offline stdin/stdout harness, not a device backend. SPDX-License-Identifier: MIT */
#include "ae64_gamepad_protocol.h"
#include <stdio.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
static bool install(void *user,const struct gp_physical_config *config,uint8_t transport,const uint8_t *wire) {
    (void)user;(void)wire;return config->revision>0&&(transport==1||transport==2);
}
int main(void) {
#ifdef _WIN32
    if(_setmode(_fileno(stdin),_O_BINARY)<0||_setmode(_fileno(stdout),_O_BINARY)<0)return 1;
#endif
    uint8_t initial[GP_WIRE_BYTES];uint16_t maximum[GP_KEY_COUNT];struct gp_vendor_context context;
    if(fread(initial,1,sizeof initial,stdin)!=sizeof initial)return 2;
    for(unsigned i=0;i<GP_KEY_COUNT;i++)maximum[i]=4000;
    /* Both capabilities are simulated for protocol tests only. No USB exists. */
    if(!gp_vendor_init(&context,initial,7,GP_CAP_HID|GP_CAP_XINPUT,maximum,install,NULL))return 3;
    uint8_t request[64],reply[64];uint32_t now_ms=0;
    while(fread(request,1,64,stdin)==64) {
        now_ms+=10;
        if(!gp_vendor_handle(&context,request,reply,now_ms))return 4;
        if(fwrite(reply,1,64,stdout)!=64||fflush(stdout))return 5;
    }
    return ferror(stdin)?6:0;
}
