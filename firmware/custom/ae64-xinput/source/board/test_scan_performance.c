/* Synthetic work-count and lifecycle regressions, not hardware latency tests. */
#define main base_board_tests
#define test_stock_ram performance_stock_ram
#include "test_board.c"
#undef test_stock_ram
#undef main
static uint64_t ram_accesses;
void *test_stock_ram(uintptr_t address) { ram_accesses++;return performance_stock_ram(address); }
static uint32_t word(unsigned address) { uint32_t value;memcpy(&value,ram+address,4);return value; }
static void put32(unsigned address,uint32_t value) { memcpy(ram+address,&value,4); }
static bool neutral(void) {
    const struct gp_report *r=board_test_report();
    return !r->lx&&!r->ly&&!r->rx&&!r->ry&&!r->lt&&!r->rt&&!r->buttons&&!r->dpad;
}
static void quiet_scans(void) {
    fixture();event_callback(0,7);board_scan_hook();board_scan_hook();
    uint8_t history[64];for(unsigned k=0;k<64;k++)history[k]=ram[rec(k)+9];
    uint64_t before=ram_accesses;unsigned forced_frames=0,forced_records=0,changed_history=0;
    for(unsigned i=0;i<10000;i++) {
        ram[0x8d2d0]&=(uint8_t)~1u;
        for(unsigned k=0;k<64;k++)p16(rec(k),(*(uint16_t *)(ram+rec(k)))&~0x80u);
        board_scan_hook();forced_frames+=(word(0x8d2d0)&1u)!=0;
        for(unsigned k=0;k<64;k++) {
            forced_records+=(*(uint16_t *)(ram+rec(k))&0x80u)!=0;
            changed_history+=ram[rec(k)+9]!=history[k];
        }
    }
    uint64_t bound_accesses=ram_accesses-before;
    printf("Idle mapped scans=10000; simulated native-RAM accesses=%llu; forced input frames=%u; forced records=%u; changed event bytes=%u.\n",
           (unsigned long long)bound_accesses,forced_frames,forced_records,changed_history);
    CHECK(!forced_frames&&!forced_records&&!changed_history);
    CHECK(board_test_install(default_profile));board_scan_hook();
    before=ram_accesses;for(unsigned i=0;i<10000;i++)board_scan_hook();
    uint64_t empty_accesses=ram_accesses-before;
    printf("Empty-mapping scans=10000; simulated native-RAM accesses=%llu. Counts exclude native scanner cost and are not timing measurements.\n",
           (unsigned long long)empty_accesses);
    CHECK(empty_accesses<bound_accesses&&empty_accesses<=40000u);
}
static unsigned fn_action,fn_event;
static uint32_t resolved;
static void native_fn(void) {
    unsigned address=rec(60);ram[address+9]=(uint8_t)fn_event;
    resolved=board_key_action(address,fn_action);
    if(resolved<0xf100u||resolved>0xf103u)return;
    unsigned layer=resolved&3u;
    if(ram[address+9]==1){ram[0x82b9d]=(uint8_t)layer;ram[0x82b9e + layer]=1;ram[0x8d2d0]|=0x20;}
    else if(!ram[address+9]){for(unsigned i=layer;i<=3;i++)ram[0x82b9e + i]=0;ram[0x82b9d]=0;ram[0x8d2d0]&=(uint8_t)~0x20u;}
}
static void stock_fn_transitions(void) {
    fixture();memset(profile_flash,0xff,sizeof(profile_flash));board_fn_load_hook();process_model=native_fn;
    CHECK(rec(60)==0x82bb8+5*0x5e8+10*0x48);
    for(unsigned layer=1;layer<=3;layer++) {
        put32(0x8d260,800);key(60,3200,true);fn_action=0xf100u+layer;fn_event=1;board_key_process_hook();
        CHECK(ram[0x82b9d]==layer&&(ram[0x8d2d0]&0x20u)&&!word(0x8d260));
        unsigned before=fn_renders;board_fn_render_hook();CHECK(fn_renders==before+1&&word(0x8d084)==0x5a5a5a5au);
        put32(0x8d260,800);key(60,0,false);fn_action=4;fn_event=11;board_key_process_hook();
        CHECK(resolved==0xf100u+layer&&!ram[0x82b9d]&&!(ram[0x8d2d0]&0x20u)&&!word(0x8d260));
    }
}
static unsigned interrupt_event;
static void interrupt_evaluation(void) {
    evaluation_model=NULL;event_callback(0,(uint8_t)interrupt_event);
}
static void reset_during_evaluation(void) {
    const unsigned events_to_test[]={5,1,4,12};
    for(unsigned i=0;i<sizeof(events_to_test)/sizeof(events_to_test[0]);i++) {
        fixture();event_callback(0,7);board_scan_hook();board_scan_hook();key(15,3500,true);board_scan_hook();CHECK(board_test_report()->lt>0);
        interrupt_event=events_to_test[i];evaluation_model=interrupt_evaluation;board_scan_hook();
        CHECK(neutral()); /* The pre-interrupt result must not republish. */
        key(15,0,false);event_callback(0,interrupt_event==5?6:7);board_scan_hook();board_scan_hook();CHECK(neutral());
        key(15,3500,true);board_scan_hook();CHECK(board_test_report()->lt>0);
    }
}
int main(void) {
    quiet_scans();stock_fn_transitions();reset_during_evaluation();
    printf("PASS: %u scan-policy/performance checks; unchanged idle event history, sparse physical Fn/default overlays and interrupt-generation discard. No physical latency claim.\n",checks);
    return 0;
}
