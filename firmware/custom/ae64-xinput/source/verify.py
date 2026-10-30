"""Offline host integration tests and image audit. Does not open USB/HID devices."""
import argparse,hashlib,importlib.util,json,struct,subprocess,sys,zlib
from pathlib import Path

def check(test,message):
    if not test:raise ValueError(message)
def main():
    sys.stdout.reconfigure(encoding='utf-8')
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--zig',required=True,type=Path);p.add_argument('--stock',required=True,type=Path);p.add_argument('--image-dir',required=True,type=Path);p.add_argument('--work',required=True,type=Path)
    p.add_argument('--wasi',action='store_true',help='Run portable C tests as wasm32-wasi under Node instead of native executables')
    p.add_argument('--image',type=Path,help='Image path when the release binary is stored separately from its evidence directory')
    a=p.parse_args();root=Path(__file__).resolve().parent;out=a.image_dir.resolve();work=a.work.resolve();work.mkdir(parents=True,exist_ok=True)
    host_target=['-target','wasm32-wasi'] if a.wasi else []
    suffix='.wasm' if a.wasi else '.exe'
    def run_test(file):return ['node',str(root/'run-wasi.cjs'),str(file)] if a.wasi else [str(file)]
    spec=importlib.util.spec_from_file_location('patch_build',root/'build.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    manifest=json.loads((out/'build-manifest.json').read_text(encoding='utf-8'));stock=a.stock.read_bytes();image=(a.image or out/manifest['image']).read_bytes();payload=image[4096:]
    check(hashlib.sha256(stock).hexdigest()==m.STOCK_SHA,'Stock hash')
    check(hashlib.sha256(image).hexdigest()==manifest['image_sha256'],'Image hash')
    check(struct.unpack_from('<5I',image)==(0xbeaf5aa5,0x0030000a,4096,len(payload),zlib.crc32(payload)),'Container format/CRC')
    check(len(image)%8==0 and len(image)<=0x40000,'Image alignment/bank bound')
    allowed=set(range(12,20))
    for patch in manifest['patches']:
        at=int(patch['container_offset'],16);before=bytes.fromhex(patch['before']);after=bytes.fromhex(patch['after'])
        check(stock[at:at+len(before)]==before,'Original bytes '+hex(at))
        check(image[at:at+len(after)]==after,'Patched bytes '+hex(at));allowed.update(range(at,at+len(after)))
    unexpected=[i for i,(x,y) in enumerate(zip(stock,image)) if x!=y and i not in allowed]
    check(not unexpected,'Unexpected changes to original image '+str(unexpected[:8]))
    e,sections,symbols=m.elf_read(out/'ae64-xinput-experimental.elf')
    check(struct.unpack_from('<I',e,36)[0]&6==0,'Hard-float ABI mismatch')
    for section in sections:
        if section['type']==8 and section['bytes']:check(0x8a960<=section['address']<section['address']+section['bytes']<=0x8b960,'State outside heap reservation')
        if section['flags']&2 and section['type']!=8 and section['bytes']:
            off=section['address']-m.BASE;check(payload[off:off+section['bytes']]==e[section['offset']:section['offset']+section['bytes']],'ELF/image section mismatch')
    def decode_jal(at):
        word=struct.unpack_from('<I',payload,at)[0];check(word&127==0x6f,'JAL opcode')
        delta=((word>>31)&1)<<20|((word>>21)&1023)<<1|((word>>20)&1)<<11|((word>>12)&255)<<12
        if delta&(1<<20):delta-=1<<21
        return m.BASE+at+delta,(word>>7)&31
    hooks=[(0xa594,'board_fn_render_hook',1),(0xae5e,'board_fn_load_hook',0),(0xaf9a,'board_fn_save_hook',0),(0x6e08,'board_scan_hook',1),(0x6e60,'board_schedule_hook',1),(0xea70,'board_usb_initialize',1),(0xd776,'board_dispatch_hook',0),(0xf752,'board_ep0_hook',0)]
    for at,name,rd in hooks:check(decode_jal(at)==(symbols[name]['address'],rd),'Hook destination '+name)
    for at,name in [(0x19f84,'board_device_descriptor'),(0x19f88,'board_configuration'),(0x19f90,'board_other_speed')]:
        check(struct.unpack_from('<I',payload,at)[0]==symbols[name]['address'],'USB descriptor callback '+name)
    # The preview issue must not become an unverified rewrite of the factory RGB
    # engine. All twenty native render callbacks and their table remain intact.
    stock_payload=stock[4096:]
    for begin,end,label in [(0x6e6e,0xa536,'RGB effect engine'),(0xc442,0xc544,'lighting mode handler'),(0xa9c0,0xaa36,'RGB timing loop'),(0x1456a,0x14906,'native Fn renderer'),(0x1b0b0,0x1b150,'twenty RGB callback pairs')]:
        check(payload[begin:end]==stock_payload[begin:end],label+' changed')
    for name,save,cont in [('stock_dispatch_original',0x80024c0e,0x8002e77a),('stock_ep0_original',0x80024bde,0x80030756),('stock_fn_load_original',0x80024bf4,0x8002be62),('stock_fn_save_original',0x80024c0e,0x8002bf9e)]:
        at=symbols[name]['address']-m.BASE
        check(decode_jal(at)==(save,5),'Trampoline save helper '+name)
        # Assembler may use a 32-bit JAL x0 or compressed C.J for the continuation.
        half=struct.unpack_from('<H',payload,at+4)[0]
        if half&3==3:check(decode_jal(at+4)==(cont,0),'Trampoline continuation '+name)
        else:raise ValueError('Unexpected compressed trampoline; update audit decoder')
    check(payload[0x10670:0x10674]==bytes.fromhex('37850800') and payload[0x10678:0x1067c]==bytes.fromhex('13054596'),'Heap begin instructions moved')
    check(payload[0x1066c:0x10670]+payload[0x10674:0x10678]==m.lui_addi(11,0x8a960),'Heap end reservation')
    check(payload[0x1be98:0x1bff8]==stock[0x1ce98:0x1cff8],'Copied native flash helper changed')
    sources=[*(root/'src').glob('*.c'),root/'board/board_port.c',root/'board/fn_storage.c',root/'board/gp_storage.c',root/'board/test_board.c'];exe=work/('board-tests'+suffix)
    compile_command=[str(a.zig.resolve()),'cc',*host_target,'-DAE64_HOST_TEST','-std=c11','-O2','-Wall','-Wextra','-Werror','-I',str(root/'include'),*[str(x) for x in sources],'-o',str(exe)]
    subprocess.run(compile_command,check=True);test=subprocess.run(run_test(exe),check=True,text=True,capture_output=True);print(test.stdout.strip())
    range_source=root/'board/test_range_regression.c';range_stdout=None
    if range_source.exists():
        range_file=work/('range-tests'+suffix)
        range_command=[str(a.zig.resolve()),'cc',*host_target,'-DAE64_HOST_TEST','-std=c11','-O2','-Wall','-Wextra','-Werror','-I',str(root/'include'),*[str(x) for x in [*(root/'src').glob('*.c'),root/'board/board_port.c',root/'board/fn_storage.c',root/'board/gp_storage.c',range_source]],'-o',str(range_file)]
        subprocess.run(range_command,check=True)
        range_stdout=subprocess.check_output(run_test(range_file),text=True);print(range_stdout.strip())
    fn_tests={}
    for name,extra in [('fn-protocol',[root/'board/test_fn_rgb.c']),('fn-storage',[root/'board/fn_storage.c',root/'board/gp_storage.c',root/'board/test_fn_storage.c']),('gp-storage',[root/'board/gp_storage.c',root/'board/test_gp_storage.c']),('gp-board',[root/'board/board_port.c',root/'board/fn_storage.c',root/'board/gp_storage.c',root/'board/test_gp_board.c']),('fn-board',[root/'board/board_port.c',root/'board/fn_storage.c',root/'board/gp_storage.c',root/'board/test_fn_board.c']),('usb-switch',[root/'board/board_port.c',root/'board/fn_storage.c',root/'board/gp_storage.c',root/'board/test_usb_switch.c']),('rollover',[root/'board/board_port.c',root/'board/fn_storage.c',root/'board/gp_storage.c',root/'board/test_rollover.c']),('keyboard-release',[root/'board/board_port.c',root/'board/fn_storage.c',root/'board/gp_storage.c',root/'board/test_keyboard_release.c'])]:
        command=[str(a.zig.resolve()),'cc',*host_target,'-DAE64_HOST_TEST','-std=c11','-O2','-Wall','-Wextra','-Werror','-I',str(root/'include'),*[str(x) for x in [*(root/'src').glob('*.c'),*extra]],'-o',str(work/(name+suffix))]
        subprocess.run(command,check=True)
        result=subprocess.check_output(run_test(work/(name+suffix)),text=True).strip();print(result);fn_tests[name]=result
    harness=work/('fn-harness'+suffix)
    subprocess.run([str(a.zig.resolve()),'cc',*host_target,'-std=c11','-O2','-Wall','-Wextra','-Werror','-I',str(root/'include'),*[str(x) for x in [*(root/'src').glob('*.c'),root/'board/test_fn_harness.c']],'-o',str(harness)],check=True)
    client_test=root.parents[3]/'tests/lighting/fn-protocol-tests.cjs'
    fn_tests['browser_firmware']=subprocess.check_output(['node',str(client_test),'--harness',str(harness)],text=True,encoding='utf-8').strip();print(fn_tests['browser_firmware'])
    # Independently packetize/reassemble the complete image, including its prefix.
    rebuilt=bytearray();count=0
    for off in range(0,len(image),56):
        chunk=image[off:off+56];packet=(bytes([8,2])+struct.pack('<IH',off,len(chunk))+chunk).ljust(64,b'\0')
        address,length=struct.unpack_from('<IH',packet,2);check(address==len(rebuilt) and length<=56,'Flash packet offset/length');rebuilt+=packet[8:8+length];count+=1
    check(rebuilt==image,'Flash packet round trip')
    evidence={'offline_only':True,'host_runtime':'node-wasi' if a.wasi else 'native','image_sha256':manifest['image_sha256'],'image_bytes':len(image),'static_checks':'container, original-byte preservation, ELF sections, ABI, hook destinations, trampolines, heap boundaries, native flash helpers, packet round trip','fn_tests':fn_tests,'board_test_stdout':test.stdout.strip(),'board_test_command':compile_command,'flash_packets':count,'hardware_boot':False,'windows_xinput':False,'bootloader_acceptance':False,'flashed':False}
    (out/'verification.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf8')
    if range_stdout:
        evidence['range_regression_stdout']=range_stdout.strip()
        (out/'verification.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf8')
    manifest['verified']['host_tests']=True;manifest['verified']['static_image_audit']=True
    (out/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
    print('PASS: complete image audit;',count,'flash packets; no hardware accessed.')
if __name__=='__main__':main()
