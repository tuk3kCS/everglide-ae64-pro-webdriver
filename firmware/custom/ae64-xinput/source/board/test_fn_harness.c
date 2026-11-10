/* Pipe harness for the actual browser client and portable firmware protocol. */
#define main protocol_unit_tests
#include "test_fn_rgb.c"
#undef main
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
static uint8_t main_db[4][MAIN_RGB_BYTES];
static uint32_t main_revisions[4];
static bool harness_read(void *user,uint8_t p,uint8_t l,uint8_t *out,bool *e,uint32_t *r) {
    if(l)return read_profile(user,p,l,out,e,r);
    memcpy(out,main_db[p],MAIN_RGB_BYTES);*e=true;*r=main_revisions[p];return true;
}
static bool harness_install(void *user,uint8_t p,uint8_t l,const uint8_t *data,bool e,uint32_t r) {
    if(l)return install(user,p,l,data,e,r);
    if(!e||r!=main_revisions[p])return false;
    memcpy(main_db[p],data,MAIN_RGB_BYTES);main_revisions[p]++;return true;
}
int main(void) {
#ifdef _WIN32
    _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
#endif
    fn_rgb_init(&context,harness_read,harness_install,NULL,true);
    context.main_per_profile=true;
    while(fread(request,1,64,stdin)==64) {
        if(!fn_rgb_handle(&context,request,reply,now++))return 2;
        if(fwrite(reply,1,64,stdout)!=64||fflush(stdout))return 3;
    }
    return 0;
}
