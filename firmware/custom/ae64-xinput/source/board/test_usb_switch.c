/* USB persona tests use synthetic RAM/registers only. */
#define main base_board_tests
#include "test_board.c"
#undef main
#include "gp_storage.h"
#include "fn_storage.h"
static void request(uint8_t command,bool enabled,uint32_t revision) {
    uint8_t *q=ram+0x8115c;memset(q,0,64);q[0]=0x10;q[1]=command;q[2]=1;q[3]=73;
    memcpy(q+4,"AGP1",4);
    if(command==0x27) {
        q[9]=10;q[10]=10;q[12]=0x30;q[14]=enabled;
        for(unsigned i=0;i<4;i++)q[16+i]=(uint8_t)(revision>>(i*8));
    }
    board_dispatch_hook();
}
static void tick(unsigned elapsed) { now+=elapsed;board_schedule_hook(); }
static uint32_t revision(void) { return (uint32_t)last_reply[18]|(uint32_t)last_reply[19]<<8|(uint32_t)last_reply[20]<<16|(uint32_t)last_reply[21]<<24; }
static void staging_request(bool fn,uint8_t command) {
    uint8_t *q=ram+0x8115c;memset(q,0,64);q[0]=0x10;q[1]=command;q[2]=1;q[3]=75;
    memcpy(q+4,fn?"FNR1":"AGP1",4);
    if(command==0x21) {
        q[9]=18;q[10]=1;q[18]=208;q[20]=1;
    } else if(command==0x31) {
        q[9]=20;q[11]=1;q[12]=1;q[22]=2;
    } else {
        q[9]=8;q[10]=fn?2:1;
    }
    board_dispatch_hook();
}
static void finish(bool enabled) {
    tick(30);CHECK((usb_registers[0x140/4]&1)!=0);
    tick(1);CHECK((usb_registers[0x140/4]&1)==0 && usb_registers[0x148/4]==0);
    CHECK(ram[0x80584]==1);
    /* Descriptor buffers remain old until synthetic DMA flush completes. */
    CHECK(board_configuration(1)[2]==(enabled?91:131));
    usb_registers[0x1b4/4]=0;
    tick(249);CHECK((usb_registers[0x140/4]&1)==0);
    tick(1);CHECK((usb_registers[0x140/4]&1)!=0 && usb_registers[0x148/4]==0x157);
    /* Native reset cancels DMA before callbacks release old buffers. */
    owned=NULL;event_callback(0,1);event_callback(0,7);
    CHECK(ram[0x80584]==3);
    request(0x26,false,0);CHECK(last_reply[8]==0 && last_reply[15]==enabled && last_reply[16]==enabled && last_reply[17]==0);
}
static void reboot(unsigned profile,bool enabled,uint32_t expected_revision) {
    owned=NULL;ram[0x82ba8]=(uint8_t)profile;
    memset(usb_registers,0,sizeof(usb_registers));usb_registers[0x140/4]=1;usb_registers[0x148/4]=0x157;
    CHECK(board_usb_initialize(0,0xf300c000,stock_usb_event)==0);
    event_callback(0,1);event_callback(0,7);
    request(0x26,false,0);
    CHECK(last_reply[8]==0&&last_reply[15]==enabled&&last_reply[16]==enabled&&last_reply[17]==0&&revision()==expected_revision);
    CHECK(board_configuration(1)[4]==(enabled?4:3)&&board_device_descriptor(0)[12]==(enabled?13:14));
    struct ae64_usb_setup setup={0xc0,0x20,0,4,255};uint8_t *data=NULL;uint32_t length=0;
    CHECK(board_ep0_hook(0,&setup,&data,&length)&&length==(enabled?40u:16u));
}
static void persistence(void) {
    memset(profile_flash,0xff,sizeof(profile_flash));reboot(0,true,0);
    CHECK(gp_storage_append(0,example_profile,true,17,stock_flash_program,profile_flash[0]+GP_STORAGE_OFFSET));
    /* Preserve nonzero Fn colors, all mapping bytes and the native prefix. */
    struct fn_storage colors;fn_storage_clear(&colors,0);
    memset(colors.data,0x56,FN_STORAGE_COLORS);colors.data[FN_STORAGE_COLORS]=7;colors.revision=19;
    memset(profile_flash[0]+FN_STORAGE_OFFSET,0xff,FN_STORAGE_HEADER+FN_STORAGE_BYTES);
    CHECK(fn_storage_append(&colors,stock_flash_program,profile_flash[0]+FN_STORAGE_OFFSET));
    board_fn_load_hook();
    unsigned saves=fn_saves;
    request(0x27,true,0);CHECK(last_reply[8]==0&&fn_saves==saves);
    request(0x27,false,0);CHECK(last_reply[8]==0&&fn_saves==saves+1);finish(false);
    CHECK(!memcmp(profile_flash[0]+FN_STORAGE_OFFSET+FN_STORAGE_HEADER,colors.data,FN_STORAGE_BYTES));
    CHECK(!memcmp(profile_flash[0]+GP_STORAGE_OFFSET+GP_STORAGE_HEADER,example_profile,GP_WIRE_BYTES));
    for(unsigned i=0;i<0x16ac;i++)CHECK(profile_flash[0][i]==0x69);
    reboot(0,false,1);
    /* An empty/different onboard profile must keep the global choice. */
    reboot(3,false,1);board_fn_save_hook();reboot(1,false,1);
    request(0x27,true,1);CHECK(last_reply[8]==0);finish(true);
    reboot(0,true,2);board_fn_save_hook();reboot(3,true,2);
    request(0x27,false,2);CHECK(last_reply[8]==0);finish(false);
    reboot(1,false,3);board_fn_save_hook();reboot(0,false,3);
    /* Invalid profile and flash failure cannot acknowledge a saved change. */
    ram[0x82ba8]=4;request(0x27,true,3);CHECK(last_reply[8]==GP_VENDOR_CONFLICT);
    ram[0x82ba8]=0;fail_flash=true;
    request(0x27,true,3);CHECK(last_reply[8]==GP_VENDOR_STORAGE);fail_flash=false;
    request(0x26,false,0);CHECK(last_reply[15]==0&&last_reply[17]==0&&revision()==3);
    reboot(2,false,3);
    /* Sequence wrap and corrupted records are ignored correctly at boot. */
    memset(profile_flash[2],0xff,0x2000);
    CHECK(gp_usb_storage_append(2,true,UINT32_MAX,stock_flash_program,profile_flash[2]+GP_USB_STORAGE_OFFSET));
    memset(profile_flash[3],0xff,0x2000);
    CHECK(gp_usb_storage_append(3,false,0,stock_flash_program,profile_flash[3]+GP_USB_STORAGE_OFFSET));
    memset(profile_flash[0],0xff,0x2000);memset(profile_flash[1],0xff,0x2000);
    reboot(1,false,0);
    profile_flash[3][GP_USB_STORAGE_OFFSET+12]^=1;reboot(1,true,UINT32_MAX);
}
int main(void) {
    fixture();descriptors();
    request(0x26,false,0);CHECK(last_reply[8]==0 && last_reply[9]==12 && last_reply[14]==1 && last_reply[15]==1 && revision()==0);
    request(0x27,true,0);CHECK(last_reply[8]==0 && last_reply[17]==0 && revision()==0);
    request(0x27,false,1);CHECK(last_reply[8]==GP_VENDOR_CONFLICT);
    /* USB removal must not interrupt an owned mapping/Fn upload or its CRC
     * validation/commit. Rejected switches leave each owner able to abort. */
    staging_request(false,0x21);CHECK(last_reply[8]==GP_VENDOR_OK);
    request(0x27,false,0);CHECK(last_reply[8]==GP_VENDOR_CONFLICT);
    staging_request(false,0x24);CHECK(last_reply[8]==GP_VENDOR_OK);
    staging_request(true,0x31);CHECK(last_reply[8]==GP_VENDOR_OK);
    request(0x27,false,0);CHECK(last_reply[8]==GP_VENDOR_CONFLICT);
    staging_request(true,0x34);CHECK(last_reply[8]==GP_VENDOR_OK);
    /* An abandoned upload cannot block the switch forever. */
    staging_request(false,0x21);CHECK(last_reply[8]==GP_VENDOR_OK);
    now+=5001;request(0x27,true,0);CHECK(last_reply[8]==GP_VENDOR_OK && last_reply[17]==0 && revision()==0);
    staging_request(true,0x31);CHECK(last_reply[8]==GP_VENDOR_OK);
    now+=5001;request(0x27,true,0);CHECK(last_reply[8]==GP_VENDOR_OK && last_reply[17]==0 && revision()==0);
    uint8_t *q=ram+0x8115c;
    request(0x27,false,0);CHECK(last_reply[8]==0 && last_reply[15]==1 && last_reply[16]==0 && last_reply[17]==1 && revision()==1);
    request(0x27,false,1);CHECK(last_reply[8]==GP_VENDOR_CONFLICT);
    /* No configuration transaction can start after a USB switch is queued. */
    staging_request(false,0x21);CHECK(last_reply[8]==GP_VENDOR_CONFLICT);
    staging_request(true,0x31);CHECK(last_reply[8]==GP_VENDOR_CONFLICT);
    /* Pending ACK ring and EP3 DMA independently block disconnect. */
    ram[0x8d2b0]=1;tick(40);CHECK((usb_registers[0x140/4]&1)!=0);
    /* A pending ACK/detach does not temporarily turn mapped keys into typing. */
    key(15,3500,true);board_scan_hook();CHECK(ram[rec(15)+9]==1 && board_test_report()->lt==0);
    ram[0x8d2b1]=1;usb_registers[0x1b0/4]=1u<<19;tick(1);CHECK((usb_registers[0x140/4]&1)!=0);
    usb_registers[0x1b0/4]=0;usb_registers[0x1b8/4]=1u<<19;tick(1);CHECK((usb_registers[0x140/4]&1)!=0);
    usb_registers[0x1b8/4]=0;finish(false);
    CHECK(board_configuration(1)[4]==3 && board_other_speed(0)[2]==91 && board_device_descriptor(0)[12]==14);
    /* Only the stock descriptor prefix is visible. The appended tail is cleared. */
    CHECK(memcmp(board_configuration(1)+4,ram+0x80318+4,87)==0);
    for(unsigned i=91;i<131;i++)CHECK(board_configuration(1)[i]==0);
    struct ae64_usb_setup s={0xc0,0x20,0,4,255};uint8_t *data=0;uint32_t length=0;
    CHECK(board_ep0_hook(0,&s,&data,&length)&&length==16&&data[8]==0);
    key(15,3500,true);board_scan_hook();CHECK(ram[rec(15)+9]==1 && board_test_report()->lt==0);
    unsigned before=writes;tick(1);CHECK(writes==before);
    request(0x27,true,1);CHECK(last_reply[8]==0 && revision()==2);finish(true);
    CHECK(board_configuration(1)[4]==4 && board_device_descriptor(0)[12]==13);
    CHECK(board_ep0_hook(0,&s,&data,&length)&&length==40&&memcmp(data+18,"XUSB10",6)==0);
    for(unsigned k=0;k<64;k++)key(k,0,false);board_scan_hook();board_scan_hook();key(15,3500,true);board_scan_hook();CHECK(board_test_report()->lt==255);
    /* Missing SOF cannot hang the scheduler; fall back after 20ms. */
    owned=NULL;request(0x27,false,2);tick(30);usb_registers[0x144/4]=0;tick(19);CHECK(usb_registers[0x140/4]&1);tick(1);CHECK(!(usb_registers[0x140/4]&1));usb_registers[0x1b4/4]=0;tick(250);owned=NULL;event_callback(0,1);event_callback(0,7);
    /* Malformed requests never start a transition. */
    request(0x27,true,3);q[15]=1;board_dispatch_hook();CHECK(last_reply[8]==GP_VENDOR_FORMAT);
    /* Let the already accepted transition complete, then exercise ACK timeout. */
    finish(true);request(0x27,false,4);ram[0x8d2b0]++;tick(1501);request(0x26,false,0);CHECK(last_reply[15]==1&&last_reply[16]==1&&last_reply[17]==0);
    /* A failed endpoint flush must retain descriptor bytes and restore native
     * write eligibility. There is no unbounded wait and no partial persona. */
    ram[0x8d2b1]=ram[0x8d2b0];owned=NULL;
    request(0x27,false,5);CHECK(last_reply[8]==0);tick(30);tick(1);
    uint8_t descriptor[18];memcpy(descriptor,board_device_descriptor(0),18);
    tick(250);CHECK(!(usb_registers[0x140/4]&1));
    CHECK(memcmp(descriptor,board_device_descriptor(0),18)==0&&ram[0x80584]==1);
    tick(750);CHECK((usb_registers[0x140/4]&1)&&ram[0x80584]==3);
    request(0x26,false,0);CHECK(last_reply[15]==1&&last_reply[16]==1&&last_reply[17]==0);
    persistence();
    printf("PASS: %u synthetic USB persona/persistent preference/reboot/profile/ACK/DMA/storage-failure checks; no hardware accessed.\n",checks);
    return 0;
}
