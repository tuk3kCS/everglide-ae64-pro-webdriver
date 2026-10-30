/* Normal keyboard held-list regression; synthetic RAM only. SPDX-License-Identifier: MIT */
#define AE64_ROLLOVER_ENTRY rollover_tests
#include "test_rollover.c"
static bool keyboard_held[64];
static int repeat_key;
static unsigned keyboard_frames;
/* The pinned generic-key path accepts press event 1 and release 11. Idle 0
 * does not drain the independent held-key list. A different pressed key can
 * take Windows' repeat selection without releasing the older held key. */
static void keyboard_process(void) {
    if(!(ram[0x8d2d0]&1))return;
    ram[0x8d2d0]&=(uint8_t)~1u;
    for(unsigned k=0;k<64;k++) {
        unsigned r=rec(k);uint16_t flags=(uint16_t)(ram[r]|ram[r+1]<<8);
        if(!(flags&0x82))continue;
        ram[r]&=(uint8_t)~0x80u;
        unsigned event=ram[r+9];
        if(event==1) {if(!keyboard_held[k])repeat_key=(int)k;keyboard_held[k]=true;ram[r]|=2;keyboard_frames++;}
        else if(event==11) {keyboard_held[k]=false;if(repeat_key==(int)k)repeat_key=-1;ram[r]&=(uint8_t)~2u;keyboard_frames++;}
    }
}
static void step(void) { now++;board_scan_hook();keyboard_process(); }
static void clear_keyboard(void) { memset(keyboard_held,0,sizeof(keyboard_held));repeat_key=-1;keyboard_frames=0; }
static void normal_event(unsigned k,unsigned event,bool down) {
    key(k,down?3200:0,down);ram[rec(k)+9]=(uint8_t)event;
    ram[rec(k)]|=0x80;ram[0x8d2d0]|=1;
}
static void setup_keyboard(void) {setup_wasd();scan_model=NULL;clear_keyboard();}
static void existing_hold(void) {
    const unsigned wasd[4]={16,29,30,31};
    for(unsigned i=0;i<4;i++)for(unsigned already_idle=0;already_idle<2;already_idle++) {
        setup_keyboard();unsigned k=wasd[i];
        wasd_wire[5]=GP_MIXED;CHECK(board_test_install(wasd_wire));
        normal_event(k,1,true);step();CHECK(keyboard_held[k] && repeat_key==(int)k);
        wasd_wire[5]=GP_CONTROLLER_ONLY;CHECK(board_test_install(wasd_wire));
        key(k,already_idle?0:3200,already_idle==0);ram[rec(k)+9]=(uint8_t)(already_idle?0:2);
        /* Even when native flags already consumed the last event, drain it. */
        ram[rec(k)]&=(uint8_t)~0x82u;
        step();CHECK(!keyboard_held[k] && repeat_key==-1);
        unsigned before=keyboard_frames;for(unsigned n=0;n<32;n++)step();
        CHECK(!keyboard_held[k] && keyboard_frames>=before);
    }
}
static void backspace_is_not_key_up(void) {
    setup_keyboard();wasd_wire[5]=GP_MIXED;CHECK(board_test_install(wasd_wire));
    normal_event(29,1,true);keyboard_process();CHECK(keyboard_held[29] && repeat_key==29);
    normal_event(13,1,true);keyboard_process();CHECK(keyboard_held[29] && repeat_key==13);
    normal_event(13,11,false);keyboard_process();CHECK(keyboard_held[29] && repeat_key==-1);
    wasd_wire[5]=GP_CONTROLLER_ONLY;CHECK(board_test_install(wasd_wire));
    key(29,0,false);step();CHECK(!keyboard_held[29]);
}
static void normal_and_controller(void) {
    setup_keyboard();
    /* Shift, Backspace and an ordinary unbound key keep their independent holds. */
    const unsigned other[3]={13,32,41};
    for(unsigned i=0;i<3;i++){normal_event(other[i],1,true);keyboard_process();}
    for(unsigned n=0;n<64;n++) {
        normal_event(16,1,true);normal_event(29,1,true);step();
        CHECK(!keyboard_held[16] && !keyboard_held[29]);
        for(unsigned i=0;i<3;i++)CHECK(keyboard_held[other[i]]);
        normal_event(16,11,false);normal_event(29,11,false);step();
    }
    for(unsigned i=0;i<3;i++){normal_event(other[i],11,false);step();CHECK(!keyboard_held[other[i]]);}
    /* Canonical digital latch still reaches the controller before suppression. */
    wasd_wire[16+10*8]=32;CHECK(board_test_install(wasd_wire));
    key(16,0,false);key(29,0,false);key(32,0,false);step();step();
    normal_event(32,1,true);step();CHECK(board_test_report()->buttons==1 && !keyboard_held[32]);
    normal_event(32,11,false);step();CHECK(board_test_report()->buttons==0);
}
static void calibration_guards(void) {
    for(unsigned fault=0;fault<3;fault++) {
        setup_keyboard();
        if(fault==0)p16(perf(16)+2,0);
        if(fault==1)p16(perf(16)+2,3000); /* saved endpoint no longer fits */
        if(fault==2)ram[perf(16)+8]=0;
        normal_event(29,1,true);step();CHECK(!keyboard_held[29]);
        CHECK(board_test_report()->lx==0 && board_test_report()->ly==0);
        p16(perf(16)+2,3310);ram[perf(16)+8]=1;step();CHECK(!keyboard_held[29]);
    }
}
static void mode_passthrough(void) {
    setup_keyboard();wasd_wire[5]=GP_MIXED;CHECK(board_test_install(wasd_wire));
    normal_event(29,1,true);step();CHECK(keyboard_held[29]);
    normal_event(29,11,false);step();CHECK(!keyboard_held[29]);
    wasd_wire[5]=GP_OFF;CHECK(board_test_install(wasd_wire));
    normal_event(29,1,true);step();CHECK(keyboard_held[29]);
    normal_event(29,11,false);step();CHECK(!keyboard_held[29]);
}
static bool host_held[64],queued_held[64],drop_packet;
static unsigned host_frames;
static void keyboard_send(void) {
    if(!(ram[0x8081c]&3))return;
    bool boot=(ram[0x8d2d5]&1)!=0;
    CHECK((ram[0x8081c]&3)==(boot?1:2));
    ram[0x8081c]&=(uint8_t)~3u;
    if(!boot) {
        if(ram[0x8d200] && !memcmp(queued_held,keyboard_held,sizeof(queued_held)))return;
        memcpy(queued_held,keyboard_held,sizeof(queued_held));ram[0x8d200]=1;
    }
    if(drop_packet){drop_packet=false;return;}
    memcpy(host_held,keyboard_held,sizeof(host_held));host_frames++;
}
static void lost_release_reconciliation(void) {
    for(unsigned boot=0;boot<2;boot++) {
    setup_keyboard();schedule_model=keyboard_send;memset(host_held,0,sizeof(host_held));host_frames=0;
    ram[0x8d2d5]=(uint8_t)boot;
    keyboard_held[41]=true;host_held[41]=true;host_held[29]=true;
    ram[0x8081c]=(uint8_t)(boot?1:2);drop_packet=true;
    board_schedule_hook();CHECK(host_held[29] && host_frames==0);
    for(unsigned i=1;i<50;i++){now=i;board_schedule_hook();CHECK(host_frames==0);}
    ram[0x8081c]=0x18;now=50;board_schedule_hook();
    CHECK(!host_held[29] && host_held[41] && host_frames==1 && ram[0x8081c]==0x18);
    for(unsigned i=51;i<100;i++){now=i;board_schedule_hook();CHECK(host_frames==1);}
    now=100;board_schedule_hook();CHECK(host_frames==2);
    event_callback(0,5);now=150;board_schedule_hook();CHECK(host_frames==2);
    event_callback(0,6);board_schedule_hook();CHECK(host_frames==3);
    ram[0x80584]=1;now=200;board_schedule_hook();CHECK(host_frames==3);
    ram[0x80584]=3;board_schedule_hook();CHECK(host_frames==4);
    wasd_wire[5]=GP_MIXED;CHECK(board_test_install(wasd_wire));now=250;board_schedule_hook();CHECK(host_frames==4);
    wasd_wire[5]=GP_OFF;CHECK(board_test_install(wasd_wire));now=300;board_schedule_hook();CHECK(host_frames==4);
    }
}
int main(void) {
    existing_hold();backspace_is_not_key_up();normal_and_controller();calibration_guards();mode_passthrough();lost_release_reconciliation();
    printf("PASS: keyboard held-list releases, consumed/idle events, unbound keys, digital latches, sensor faults, mode passthrough, lost-packet reconciliation, cadence and suspend/USB guards; %u checks.\n",checks);
    return 0;
}
