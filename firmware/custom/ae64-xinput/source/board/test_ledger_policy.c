/* Native working-ledger policy regression tests. No devices or MMIO.
 * SPDX-License-Identifier: MIT
 */
#include "keyboard_policy.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks;
#define CHECK(condition) do { checks++;if(!(condition)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#condition);exit(1);} }while(0)

static void aliases(void) {
    /* Physical A (key29, row3/col1) and top-row key3 (row1/col3) both used
     * native owner8: (row+1)*(col+1). Their normalized owners30/4 remain
     * independent when remapped to A or Left Ctrl. Duplicate blocked pairs
     * must all be drained without releasing the unbound alias. */
    uint8_t ledger[]={
        4,30, 4,4, 0xe0,30, 0xe0,4, 4,240, 4,30,
        0xe7,64, 0xe7,63, 9,0, 10,65, 11,126, 12,255
    };
    const uint8_t expected[]={4,4, 0xe0,4, 4,240, 0xe7,63, 9,0, 10,65, 11,126, 12,255};
    uint32_t count=sizeof(ledger)/2;
    uint64_t blocked=(UINT64_C(1)<<29)|(UINT64_C(1)<<63);
    count=keyboard_policy_compact(ledger,count,blocked);
    CHECK(count==sizeof(expected)/2);
    CHECK(memcmp(ledger,expected,sizeof(expected))==0);
    uint8_t saved[sizeof(ledger)];memcpy(saved,ledger,sizeof(ledger));
    CHECK(keyboard_policy_compact(ledger,count,blocked)==count);
    CHECK(memcmp(ledger,saved,sizeof(ledger))==0);
    /* The policy does not reinterpret usage bytes as ownership. */
    uint8_t remaps[]={30,4, 240,30, 64,240};
    CHECK(keyboard_policy_compact(remaps,3,UINT64_C(1)<<29)==2);
    CHECK(remaps[0]==30 && remaps[1]==4 && remaps[2]==64 && remaps[3]==240);
}

static void boundaries(void) {
    uint8_t guarded[260],before[260];memset(guarded,0xa7,sizeof(guarded));
    volatile uint8_t *ledger=guarded+2;
    for(unsigned i=0;i<128;i++){guarded[2+i*2]=(uint8_t)i;guarded[3+i*2]=(uint8_t)(i+1);}
    memcpy(before,guarded,sizeof(before));
    CHECK(keyboard_policy_compact(ledger,128,0)==128);
    CHECK(memcmp(guarded,before,sizeof(guarded))==0);
    CHECK(keyboard_policy_compact(ledger,0,UINT64_MAX)==0);
    CHECK(memcmp(guarded,before,sizeof(guarded))==0);
    CHECK(keyboard_policy_compact(ledger,129,UINT64_MAX)==129);
    CHECK(keyboard_policy_compact(ledger,UINT32_MAX,UINT64_MAX)==UINT32_MAX);
    CHECK(keyboard_policy_compact(0,128,UINT64_MAX)==128);
    CHECK(memcmp(guarded,before,sizeof(guarded))==0);
    CHECK(keyboard_policy_compact(ledger,128,UINT64_MAX)==64);
    for(unsigned i=0;i<64;i++) {
        CHECK(ledger[i*2]==i+64);
        CHECK(ledger[i*2+1]==i+65);
    }
    CHECK(guarded[0]==0xa7 && guarded[1]==0xa7 && guarded[258]==0xa7 && guarded[259]==0xa7);
    uint8_t ends[]={7,1, 7,2, 7,63, 7,64};
    CHECK(keyboard_policy_compact(ends,4,UINT64_C(1)|(UINT64_C(1)<<63))==2);
    CHECK(ends[0]==7 && ends[1]==2 && ends[2]==7 && ends[3]==63);
}

static uint32_t random_word(uint32_t *state) {
    *state^=*state<<13;*state^=*state>>17;*state^=*state<<5;return *state;
}
static void generated(void) {
    uint32_t state=0x91c0ffeeu;
    for(unsigned round=0;round<2048;round++) {
        uint8_t guarded[260],before[260],expected[256],blocked_owner[256]={0};
        for(unsigned i=0;i<sizeof(guarded);i++)guarded[i]=(uint8_t)random_word(&state);
        uint32_t count=round%129u,kept=0;
        uint64_t blocked=(uint64_t)random_word(&state)<<32|random_word(&state);
        for(unsigned owner=1;owner<=64;owner++)blocked_owner[owner]=(uint8_t)((blocked>>(owner-1))&1u);
        /* Build an independent output sequence before the in-place operation. */
        for(unsigned i=0;i<count;i++) {
            const uint8_t *pair=guarded+2+i*2;
            if(!blocked_owner[pair[1]]){expected[kept*2]=pair[0];expected[kept*2+1]=pair[1];kept++;}
        }
        memcpy(before,guarded,sizeof(before));
        CHECK(keyboard_policy_compact(guarded+2,count,blocked)==kept);
        CHECK(memcmp(guarded+2,expected,kept*2)==0);
        CHECK(memcmp(guarded,before,2)==0);
        /* Neither native cache nor neighboring memory is touched. */
        CHECK(memcmp(guarded+2+count*2,before+2+count*2,sizeof(guarded)-2-count*2)==0);
        memcpy(before,guarded,sizeof(before));
        CHECK(keyboard_policy_compact(guarded+2,kept,blocked)==kept);
        CHECK(memcmp(guarded,before,sizeof(guarded))==0);
    }
}

int main(void) {
    aliases();boundaries();generated();
    printf("PASS: %u working-ledger policy checks; aliases/modifiers, duplicate owners, macro ownership, all physical bits, capacity/guards and stable compaction. No hardware accessed.\n",checks);
    return 0;
}
