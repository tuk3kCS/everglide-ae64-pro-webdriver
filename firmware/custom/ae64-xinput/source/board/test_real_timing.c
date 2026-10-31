/* Separate real hardware milliseconds from the native busy-loop/RTOS tick. */
#define main base_board_tests
#define stock_tick legacy_fixture_tick
#include "test_board.c"
#undef stock_tick
#undef main
uint32_t stock_tick(void) { uint32_t ms;memcpy(&ms,ram+0x8d2f4,4);return ms; }
static void milliseconds(uint32_t ms){memcpy(ram+0x8d2f4,&ms,4);}
static void busy(unsigned count) {
    for(unsigned i=0;i<count;i++){uint32_t tick=i;memcpy(ram+0x8d320,&tick,4);board_schedule_hook();}
}
int main(void) {
    fixture();event_callback(0,7);board_scan_hook();board_scan_hook();
    unsigned before=writes;busy(2000);CHECK(writes==before);
    milliseconds(1);board_scan_hook();board_schedule_hook();CHECK(writes==before+1);complete();
    busy(2000);CHECK(writes==before+1);
    milliseconds(2);board_schedule_hook();CHECK(writes==before+2);
    milliseconds(3);board_schedule_hook();CHECK(writes==before+2);complete();
    board_schedule_hook();CHECK(writes==before+3);complete();
    milliseconds(10);key(16,3500,true);board_scan_hook();CHECK(board_test_report()->ly>0);
    board_schedule_hook();complete();busy(2000);CHECK(board_test_report()->ly>0);
    milliseconds(60);board_schedule_hook();CHECK(board_test_report()->ly>0);complete();
    milliseconds(61);board_schedule_hook();CHECK(board_test_report()->ly==0);complete();
    /* Millisecond wrap remains a short elapsed time, not a giant timeout. */
    milliseconds(0xfffffffeu);key(16,0,false);board_scan_hook();board_scan_hook();board_schedule_hook();complete();
    milliseconds(0xffffffffu);board_scan_hook();board_schedule_hook();complete();
    before=writes;milliseconds(0);board_scan_hook();board_schedule_hook();CHECK(writes==before+1);complete();
    printf("PASS: independent hardware-ms clock, 1ms controller cadence, frozen-clock busy loops, DMA ownership, 50ms watchdog and clock wrap; %u checks.\n",checks);
    return 0;
}
