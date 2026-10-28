/* Pipe harness for the actual browser client and portable firmware protocol. */
#define main protocol_unit_tests
#include "test_fn_rgb.c"
#undef main
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
int main(void) {
#ifdef _WIN32
    _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
#endif
    fn_rgb_init(&context,read_profile,install,NULL,true);
    while(fread(request,1,64,stdin)==64) {
        if(!fn_rgb_handle(&context,request,reply,now++))return 2;
        if(fwrite(reply,1,64,stdout)!=64||fflush(stdout))return 3;
    }
    return 0;
}
