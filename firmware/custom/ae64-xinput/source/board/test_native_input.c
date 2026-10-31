/* Native-output phase/context regression, synthetic RAM only. SPDX-License-Identifier: MIT */
#define AE64_ROLLOVER_ENTRY rollover_tests
#include "test_rollover.c"
#ifdef AE64_LEGACY_INPUT
void board_key_context(uintptr_t address){(void)address;}
void board_keyboard_press_hook(uint32_t usage,uint32_t owner){stock_keyboard_press_original(usage,owner);}
void board_keyboard_release_hook(uint32_t usage,uint32_t owner){stock_keyboard_release_original(usage,owner);}
void board_advanced_key_hook(uintptr_t r,uintptr_t p,uint32_t owner){stock_advanced_key_original(r,p,owner);}
uint32_t board_key_action(uintptr_t r,uint32_t action){(void)r;return action;}
void board_key_process_hook(void){stock_key_process();}
#endif
static bool ledger[256][256];
static unsigned appends;
static void append(uint32_t usage,uint32_t owner){CHECK(usage<256&&owner<256);ledger[usage][owner]=true;appends++;}
static void remove_key(uint32_t usage,uint32_t owner){CHECK(usage<256&&owner<256);ledger[usage][owner]=false;}
static bool any_usage(unsigned usage){for(unsigned i=0;i<256;i++)if(ledger[usage][i])return true;return false;}
static unsigned source_key,source_usage,source_token;
static void native_emit(void) {
    board_key_context(rec(source_key));
    /* Native later/timed phases can produce a press and enqueue immediately,
     * after the board's post-scan event rewrite. The common append must gate it. */
    board_keyboard_press_hook(source_usage,source_token);
}
static void advanced_emit(uintptr_t r,uintptr_t p,uint32_t token){(void)r;(void)p;board_keyboard_press_hook(source_usage,token);}
static void input_setup(void) {
    setup_wasd();scan_model=NULL;memset(ledger,0,sizeof(ledger));appends=0;
    press_model=append;release_model=remove_key;process_model=native_emit;advanced_model=advanced_emit;
    /* T (physical19), independent LT, as reported by the user. */
    wasd_wire[16]=19;wasd_wire[18]=200;wasd_wire[19]=0;
    wasd_wire[20]=0x80;wasd_wire[21]=0x0c;wasd_wire[22]=0xee;wasd_wire[23]=0x0c;
    CHECK(board_test_install(wasd_wire));
}
static void spam(void) {
    input_setup();const unsigned keys[5]={16,29,30,31,19},usages[5]={26,4,22,7,23};
    for(unsigned i=0;i<1200;i++)for(unsigned j=0;j<5;j++) {
        source_key=keys[j];source_usage=usages[j];source_token=8+j;
        key(source_key,3200,true);now++;board_scan_hook();unsigned before=appends;
        board_key_process_hook();CHECK(appends==before&&!any_usage(source_usage));
        board_advanced_key_hook(rec(source_key),perf(source_key),source_token);
        CHECK(appends==before&&!any_usage(source_usage));
        key(source_key,0,false);now++;board_scan_hook();board_key_process_hook();
        CHECK(appends==before&&!any_usage(source_usage));
    }
}
static void aliases_and_context(void) {
    input_setup();source_key=3;source_usage=4;source_token=8;
    /* Native tokens collide: row1,col3 and row3,col1 both yield8. Both physical
     * sources also intentionally emit A. A mapped source must not erase alias. */
    board_key_process_hook();CHECK(any_usage(4));
    source_key=29;unsigned before=appends;board_key_process_hook();CHECK(appends==before&&any_usage(4));
    board_key_context(rec(29));board_keyboard_release_hook(4,8);CHECK(any_usage(4));
    board_key_context(rec(3));board_keyboard_release_hook(4,8);CHECK(!any_usage(4));
    source_key=0;source_usage=225;source_token=2;board_key_process_hook();CHECK(any_usage(225));
    board_key_context(rec(0));board_keyboard_release_hook(225,2);CHECK(!any_usage(225));
    /* No physical source is retained after the native action processor returns. */
    source_key=29;source_usage=4;board_key_process_hook();before=appends;
    board_keyboard_press_hook(4,240);CHECK(appends==before+1&&ledger[4][240]);
    board_key_context(0);board_keyboard_release_hook(4,240);CHECK(!ledger[4][240]);
    /* Invalid/misaligned/phantom records cannot select an unrelated physical key. */
    board_key_context(rec(29)+1);board_keyboard_press_hook(4,240);CHECK(ledger[4][240]);
    board_key_context(0x82bb8);board_keyboard_release_hook(4,240);CHECK(!ledger[4][240]);
    wasd_wire[5]=GP_MIXED;CHECK(board_test_install(wasd_wire));source_key=29;source_token=8;
    board_key_process_hook();CHECK(any_usage(4));
    wasd_wire[5]=GP_CONTROLLER_ONLY;CHECK(board_test_install(wasd_wire));
    board_key_context(rec(29));board_keyboard_release_hook(4,8);CHECK(!any_usage(4));
    wasd_wire[5]=GP_OFF;CHECK(board_test_install(wasd_wire));board_key_process_hook();CHECK(any_usage(4));
}
static unsigned fn_key,fn_action,fn_event;
static uint32_t resolved;
static void native_fn_event(void) {
    unsigned r=rec(fn_key);ram[r+9]=(uint8_t)fn_event;
    board_key_context(r);resolved=board_key_action(r,fn_action);
    /* Native F1xx action handling uses press1 and idle0, not normal key-up11. */
    if(resolved>=0xf100&&resolved<=0xf103) {
        unsigned layer=resolved&3;
        if(ram[r+9]==1){ram[0x82b9d]=(uint8_t)layer;ram[0x82b9e + layer]=1;ram[0x8d2d0]|=0x20;}
        if(ram[r+9]==0){for(unsigned i=layer;i<=3;i++)ram[0x82b9e + i]=0;ram[0x82b9d]=0;ram[0x8d2d0]&=(uint8_t)~0x20u;}
    }
}
static void fn_edge(unsigned key_id,unsigned action,unsigned event,bool down) {
    fn_key=key_id;fn_action=action;fn_event=event;key(key_id,down?3200:0,down);
    board_key_process_hook();
}
static void fn_momentary(void) {
    input_setup();process_model=native_fn_event;
    for(unsigned layer=1;layer<=3;layer++)for(unsigned key_id=0;key_id<64;key_id++) {
        if(key_id==16||key_id==19||key_id==29||key_id==30||key_id==31)continue;
        p16(0x8d260,800);p16(0x8d262,0);
        fn_edge(key_id,0xf100+layer,1,true);
        CHECK(ram[0x82b9d]==layer&&(ram[0x8d2d0]&0x20)&&!ram[0x8d260]&&!ram[0x8d261]);
        fn_edge(key_id,4,2,true);CHECK(resolved==0xf100+layer&&ram[0x82b9d]==layer);
        fn_edge(key_id,4,11,false);CHECK(resolved==0xf100+layer&&ram[0x82b9d]==0&&!(ram[0x8d2d0]&0x20));
    }
    fn_edge(17,0xf102,1,true);fn_edge(18,0xf103,1,true);CHECK(ram[0x82b9d]==3);
    fn_edge(17,4,11,false);CHECK(ram[0x82b9d]==3&&(ram[0x8d2d0]&0x20));
    fn_edge(18,4,11,false);CHECK(!ram[0x82b9d]&&!(ram[0x8d2d0]&0x20));
    fn_edge(17,0xf102,1,true);fn_edge(18,0xf102,1,true);
    fn_edge(17,4,11,false);CHECK(ram[0x82b9d]==2);
    fn_edge(18,4,11,false);CHECK(!ram[0x82b9d]);
    fn_edge(29,0xf102,1,true);CHECK(resolved==0&&!(ram[0x8d2d0]&0x20));
    fn_edge(17,0xf102,1,true);key(17,0,false);process_model=NULL;board_key_process_hook();
    CHECK(!ram[0x82b9d]&&!(ram[0x8d2d0]&0x20));
    process_model=native_fn_event;fn_edge(17,0xf102,1,true);
    ram[0x82ba8]=1;board_fn_load_hook();
    fn_edge(17,4,11,false);CHECK(resolved==0xf102&&!ram[0x82b9d]&&!(ram[0x8d2d0]&0x20));
}
int main(void) {
#ifdef AE64_FN_ONLY
    (void)&spam;(void)&aliases_and_context;fn_momentary();
#else
    spam();aliases_and_context();fn_momentary();
#endif
    printf("PASS: exact physical append/release gates, 6000 spam cycles, colliding-owner aliases, scoped timed/direct contexts, Fn1-3 origins and immediate RGB deadline; %u checks.\n",checks);return 0;
}
