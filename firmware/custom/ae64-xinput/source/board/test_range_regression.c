#define main base_board_tests
#include "test_board.c"
#undef main
static void put32(uint8_t *p,uint32_t x){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(x>>(i*8));}
static unsigned custom(uint8_t command,const uint8_t *data,unsigned length) {
    uint8_t *q=ram+0x80b00+0x65c;memset(q,0,64);
    q[0]=0x10;q[1]=command;q[2]=1;q[3]=77;memcpy(q+4,"AGP1",4);q[9]=(uint8_t)length;
    if(length)memcpy(q+10,data,length);board_dispatch_hook();return last_reply[8];
}
static unsigned upload(const uint8_t wire[208]) {
    const uint8_t token[8]={4,3,2,1,8,7,6,5};
    uint8_t begin[18]={0};put32(begin,1);put32(begin+4,gp_crc32(wire,208));begin[8]=208;memcpy(begin+10,token,8);
    CHECK(custom(0x21,begin,18)==0);
    for(unsigned off=0;off<208;off+=40) {
        uint8_t data[50]={0};unsigned n=208-off;if(n>40)n=40;
        memcpy(data,token,8);data[8]=(uint8_t)off;data[9]=(uint8_t)(off>>8);memcpy(data+10,wire+off,n);
        CHECK(custom(0x22,data,10+n)==0);
    }
    uint8_t commit[16];memcpy(commit,token,8);put32(commit+8,gp_crc32(wire,208));put32(commit+12,1);
    unsigned result=custom(0x23,commit,16);
    if(result)CHECK(custom(0x24,token,8)==0);
    return result;
}
int main(void) {
    base_board_tests();fixture();for(unsigned key=0;key<64;key++)p16(perf(key)+2,3310);
    CHECK(upload(default_profile)==GP_VENDOR_CONFIG);
    uint8_t wire[208];memcpy(wire,default_profile,208);
    for(unsigned i=0;i<24;i++)if(wire[16+i*8]!=255) {
        unsigned o=16+i*8;wire[o+4]=0xb8;wire[o+5]=0x0b;wire[o+6]=0xee;wire[o+7]=0x0c;
    }
    CHECK(upload(wire)==GP_VENDOR_OK);
    CHECK(custom(0x20,NULL,0)==0 && last_reply[18]==2);
    printf("PASS: live 3.31mm range regression; default 3.50mm rejected, 3.00mm profile committed. %u checks.\n",checks);
    return 0;
}
