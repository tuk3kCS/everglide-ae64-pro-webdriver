#define main fixture_main
#define test_stock_ram counted_stock_ram
#include "../source/board/test_board.c"
#undef main
#undef test_stock_ram
static uint64_t accesses;
void *test_stock_ram(uintptr_t a){accesses++;return counted_stock_ram(a);}
int main(void){fixture();event_callback(0,7);board_scan_hook();board_scan_hook();
uint64_t start=accesses;unsigned pending=0,records=0;
for(unsigned i=0;i<10000;i++){ram[0x8d2d0]&=(uint8_t)~1u;for(unsigned k=0;k<64;k++)ram[rec(k)]&=(uint8_t)~0x80u;
board_scan_hook();pending+=(ram[0x8d2d0]&1u)!=0;for(unsigned k=0;k<64;k++)records+=(ram[rec(k)]&0x80u)!=0;}
printf("{\"scans\":10000,\"native_ram_accesses\":%llu,\"forced_input_frames\":%u,\"forced_records\":%u}",(unsigned long long)(accesses-start),pending,records);return 0;}
