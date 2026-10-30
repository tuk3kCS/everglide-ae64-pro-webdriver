/* Scanner event-history regression. No hardware access. SPDX-License-Identifier: MIT */
#define main base_board_tests
#include "test_board.c"
#undef main
static uint16_t physical[64];
static unsigned event_changes;
/* Native scanner contract: update travel/latch in matrix order, return after
 * the first changed r+9 event, continue next pass when that event is stable.
 * Normal press -> event 5 -> held 2; release -> event 11 -> idle 0. */
static void native_scan_model(void) {
    for(unsigned k=0;k<64;k++) {
        bool was_down=(ram[rec(k)+8]&1u)!=0,down=physical[k]>=2000;
        uint8_t event=down?(was_down?2:5):(was_down?11:0);
        p16(rec(k)+0x1a,physical[k]);ram[rec(k)+8]=down?1:0;
        if(ram[rec(k)+9]!=event) {ram[rec(k)+9]=event;event_changes++;return;}
    }
}
static void settle(void) { for(unsigned i=0;i<8;i++){now++;board_scan_hook();} }
static uint8_t wasd_wire[208];
static void setup_wasd(void) {
    fixture();memset(physical,0,sizeof(physical));event_changes=0;
    memcpy(wasd_wire,example_profile,208);
    for(unsigned slot=0;slot<24;slot++)wasd_wire[16+slot*8]=255;
    const unsigned keys[4]={29,31,30,16};
    for(unsigned direction=0;direction<4;direction++) {
        unsigned o=16+(direction+2)*8;wasd_wire[o]=(uint8_t)keys[direction];
        wasd_wire[o+2]=200;wasd_wire[o+3]=0;
        wasd_wire[o+4]=0x80;wasd_wire[o+5]=0x0c;
        wasd_wire[o+6]=0xee;wasd_wire[o+7]=0x0c;
    }
    for(unsigned k=0;k<64;k++)p16(perf(k)+2,3310);
    CHECK(board_test_install(wasd_wire));scan_model=native_scan_model;settle();
}
static int direction(unsigned key,int axis) {
    return axis==0?(key==29?-1:(key==31?1:0)):(key==30?-1:(key==16?1:0));
}
static void expected(unsigned first,unsigned second,bool hold_first,bool hold_second) {
    const struct gp_report *r=board_test_report();
    for(int axis=0;axis<2;axis++) {
        int sign=(hold_first?direction(first,axis):0)+(hold_second?direction(second,axis):0);
        int value=axis==0?r->lx:r->ly;
        CHECK(sign==0?value==0:(sign>0?value>0:value<0));
    }
    CHECK(r->buttons==0 && r->lt==0 && r->rt==0);
    for(unsigned k=0;k<64;k++)CHECK(*(uint16_t *)(ram+rec(k)+0x1a)==physical[k]);
    CHECK(ram[rec(16)+9]==11 && ram[rec(29)+9]==11 && ram[rec(30)+9]==11 && ram[rec(31)+9]==11);
}
static void ordered_pairs(void) {
    const unsigned keys[4]={16,29,30,31};
    for(unsigned i=0;i<4;i++)for(unsigned j=0;j<4;j++)if(i!=j)for(unsigned release=0;release<2;release++) {
        setup_wasd();unsigned first=keys[i],second=keys[j];
        physical[first]=3200;settle();expected(first,second,true,false);
        physical[second]=3200;settle();expected(first,second,true,true);
        physical[second]=1200;settle();CHECK(*(uint16_t *)(ram+rec(second)+0x1a)==1200);
        physical[second]=3200;settle();expected(first,second,true,true);
        physical[release?second:first]=0;settle();expected(first,second,release==1,release==0);
        physical[release?first:second]=0;settle();expected(first,second,false,false);
        unsigned before=event_changes;settle();CHECK(event_changes==before);
    }
}
static void keyboard_modes(void) {
    setup_wasd();physical[16]=3200;physical[31]=3200;settle();
    wasd_wire[5]=GP_MIXED;CHECK(board_test_install(wasd_wire));settle();
    CHECK(ram[rec(16)+9]==2 && ram[rec(31)+9]==2);
    wasd_wire[5]=GP_CONTROLLER_ONLY;CHECK(board_test_install(wasd_wire));settle();
    CHECK(ram[rec(16)+9]==11 && ram[rec(31)+9]==11);
    physical[0]=3000;settle();CHECK(ram[rec(0)+9]==2);
    physical[31]=0;settle();CHECK(*(uint16_t *)(ram+rec(31)+0x1a)==0);
}
static void newer_event_probe(void) { CHECK(ram[rec(16)+9]==7); }
static void other_profile_probe(void) { CHECK(ram[rec(16)+9]==0); }
static void history_guards(void) {
    setup_wasd();physical[16]=3200;settle();
    ram[rec(16)+9]=7;scan_model=newer_event_probe;board_scan_hook();
    ram[0x82ba8]=1;ram[rec(16)+9]=0;scan_model=other_profile_probe;board_scan_hook();
    CHECK(ram[rec(16)+9]==0);
    setup_wasd();physical[16]=3200;settle();
    board_fn_load_hook();CHECK(ram[rec(16)+9]==2);
    ram[rec(16)+9]=0;scan_model=other_profile_probe;board_scan_hook();
}
#ifndef AE64_ROLLOVER_ENTRY
#define AE64_ROLLOVER_ENTRY main
#endif
int AE64_ROLLOVER_ENTRY(void) {
    ordered_pairs();keyboard_modes();history_guards();
    printf("PASS: scanner event history; all WASD press/release orders, diagonals, opposites, depth updates, keyboard modes and profile guards; %u checks.\n",checks);
    return 0;
}
