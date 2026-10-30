/* USB persona tests use synthetic RAM/registers only. */
#define main base_board_tests
#include "test_board.c"
#undef main
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
    ram[0x8d2b1]=1;usb_registers[0x1b0/4]=1u<<19;tick(1);CHECK((usb_registers[0x140/4]&1)!=0);
    usb_registers[0x1b0/4]=0;usb_registers[0x1b8/4]=1u<<19;tick(1);CHECK((usb_registers[0x140/4]&1)!=0);
    usb_registers[0x1b8/4]=0;finish(false);
    CHECK(board_configuration(1)[4]==3 && board_other_speed(0)[2]==91 && board_device_descriptor(0)[12]==8);
    /* Only the stock descriptor prefix is visible. The appended tail is cleared. */
    CHECK(memcmp(board_configuration(1)+4,ram+0x80318+4,87)==0);
    for(unsigned i=91;i<131;i++)CHECK(board_configuration(1)[i]==0);
    struct ae64_usb_setup s={0xc0,0x20,0,4,255};uint8_t *data=0;uint32_t length=0;
    CHECK(board_ep0_hook(0,&s,&data,&length)&&length==16&&data[8]==0);
    key(15,3500,true);board_scan_hook();CHECK(ram[rec(15)+9]==1 && board_test_report()->lt==0);
    unsigned before=writes;tick(1);CHECK(writes==before);
    request(0x27,true,1);CHECK(last_reply[8]==0 && revision()==2);finish(true);
    CHECK(board_configuration(1)[4]==4 && board_device_descriptor(0)[12]==7);
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
    printf("PASS: %u synthetic USB persona/ACK/DMA/descriptor/rearm/timeout checks; no hardware accessed.\n",checks);
    return 0;
}
