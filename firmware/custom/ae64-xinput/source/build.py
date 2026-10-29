"""Reproduce the append-only experimental patch; no hardware access or flashing."""
import argparse,hashlib,json,struct,subprocess,zlib
from pathlib import Path

STOCK_SHA='3f99093d07426db7c0a4329f3b171eafe2544c92cf5d1e1c99faa358e5b61a1d'
BASE=0x80021000
APPEND=0x8003d000
def sha(b):return hashlib.sha256(b).hexdigest()
def jal(pc,target,rd=1):
    d=target-pc
    if d%2 or not -(1<<20)<=d<(1<<20):raise ValueError('JAL out of range')
    w=((d>>20)&1)<<31|((d>>1)&0x3ff)<<21|((d>>11)&1)<<20|((d>>12)&255)<<12|rd<<7|0x6f
    return struct.pack('<I',w)
def lui_addi(register,value):
    high=(value+0x800)>>12;low=value-(high<<12)
    return struct.pack('<II',(high<<12)|(register<<7)|0x37,((low&4095)<<20)|(register<<15)|(register<<7)|0x13)
def elf_read(path):
    b=path.read_bytes()
    if b[:6]!=bytes.fromhex('7f454c460101') or struct.unpack_from('<H',b,18)[0]!=243:raise ValueError('Expected RV32 LE ELF')
    h=struct.unpack_from('<16sHHIIIIIHHHHHH',b);off,entsize,count,names=h[6],h[11],h[12],h[13]
    s=[struct.unpack_from('<IIIIIIIIII',b,off+i*entsize) for i in range(count)]
    st=s[names];strings=b[st[4]:st[4]+st[5]]
    def name(table,n):return table[n:table.index(0,n)].decode()
    sections=[];symbols={}
    for x in s:
        n=name(strings,x[0]);sections.append({'name':n,'type':x[1],'flags':x[2],'address':x[3],'offset':x[4],'bytes':x[5]})
        if x[1]==2:
            linked=s[x[6]];table=b[linked[4]:linked[4]+linked[5]]
            for p in range(x[4],x[4]+x[5],16):
                sn,v,sz,info,other,ix=struct.unpack_from('<IIIBBH',b,p)
                if sn and ix:symbols[name(table,sn)]={'address':v,'bytes':sz,'section':ix}
    return b,sections,symbols
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--zig',required=True,type=Path);p.add_argument('--stock',required=True,type=Path);p.add_argument('--out',required=True,type=Path)
    a=p.parse_args();root=Path(__file__).resolve().parent;out=a.out.resolve();out.mkdir(parents=True,exist_ok=True)
    stock=a.stock.read_bytes()
    if sha(stock)!=STOCK_SHA:raise ValueError('Only the pinned stock v0.1.0.0 binary is supported')
    if struct.unpack_from('<IIIII',stock)!=(0xbeaf5aa5,0x0030000a,0x1000,len(stock)-4096,zlib.crc32(stock[4096:])):raise ValueError('Invalid stock container')
    zig=str(a.zig.resolve());elf=out/'ae64-xinput-experimental.elf'
    sources=[*(root/'src').glob('*.c'),root/'board/board_port.c',root/'board/fn_storage.c',root/'board/runtime.c',root/'board/trampolines.S']
    commands=[];objects=[]
    for source in sources:
        obj=out/(source.stem+'.o')
        command=[zig,'cc','-target','riscv32-freestanding-none','-mcpu=generic_rv32+m+a+c','-mabi=ilp32','-ffreestanding','-fno-builtin','-fno-stack-protector','-msmall-data-limit=0','-mno-relax','-Os','-Wall','-Wextra','-Werror','-I',str(root/'include'),'-c',str(source),'-o',str(obj)]
        subprocess.run(command,check=True);commands.append(command);objects.append(obj)
    command=[zig,'build-exe','-target','riscv32-freestanding-none','-mcpu','generic_rv32+m+a+c','-O','ReleaseSmall','-fno-strip','-fentry=board_usb_initialize','--no-gc-sections','-T',str(root/'board/memory.ld'),'-femit-bin='+str(elf),*[str(x) for x in objects]]
    subprocess.run(command,check=True);commands.append(command)
    e,sections,symbols=elf_read(elf)
    relocations=[x for x in sections if x['type'] in (4,9) and x['bytes']]
    if relocations:raise ValueError('Unresolved relocation section')
    payload=bytearray(stock[4096:]);original_length=len(payload);payload.extend(b'\xff'*(APPEND-BASE-len(payload)))
    for s in sections:
        if not s['flags']&2 or not s['bytes']:continue
        if s['type']==8:
            if not 0x8a960<=s['address']<s['address']+s['bytes']<=0x8b960:raise ValueError('BSS outside reserved heap')
            continue
        if not APPEND<=s['address']<s['address']+s['bytes']<=0x80060000:raise ValueError('Patch outside inferred application bank')
        i=s['address']-BASE;end=i+s['bytes']
        if len(payload)<end:payload.extend(b'\xff'*(end-len(payload)))
        payload[i:end]=e[s['offset']:s['offset']+s['bytes']]
    patches=[]
    def patch(offset,expected,replacement,reason):
        if payload[offset:offset+len(expected)]!=expected:raise ValueError('Stock signature mismatch '+hex(offset))
        if len(expected)!=len(replacement):raise ValueError('Patch changes original length')
        payload[offset:offset+len(expected)]=replacement
        patches.append({'payload_offset':hex(offset),'container_offset':hex(offset+4096),'before':expected.hex(),'after':replacement.hex(),'reason':reason})
    def hook(offset,signature,symbol,rd=1):patch(offset,bytes.fromhex(signature),jal(BASE+offset,symbols[symbol]['address'],rd),symbol)
    hook(0xa594,'ef90707d','board_fn_render_hook')
    hook(0xae5e,'ef827fd9','board_fn_load_hook',0)
    hook(0xaf9a,'ef825fc7','board_fn_save_hook',0)
    hook(0x6e08,'eff06f8c','board_scan_hook')
    hook(0x6e60,'efe04fd9','board_schedule_hook')
    hook(0xea70,'ef10f036','board_usb_initialize')
    hook(0xd776,'ef628fc9','board_dispatch_hook',0)
    hook(0xf752,'ef42cfc8','board_ep0_hook',0)
    for off,symbol in [(0x19f84,'board_device_descriptor'),(0x19f88,'board_configuration'),(0x19f90,'board_other_speed')]:
        patch(off,stock[off+4096:off+4100],struct.pack('<I',symbols[symbol]['address']),symbol)
    # Shrink the native heap [0x87964,0x8b964) to [0x87964,0x8a960).
    # Instructions loading its begin pointer at 0x10670/0x10678 stay untouched.
    replacement=lui_addi(11,0x8a960)
    patch(0x1066c,bytes.fromhex('b7c50800'),replacement[:4],'reserve patch state: heap end upper immediate')
    patch(0x10674,bytes.fromhex('93854596'),replacement[4:],'reserve patch state: heap end lower immediate')
    patch(0x1bc80,bytes.fromhex('0200'),bytes.fromhex('0301'),'custom bcdDevice 0x0103; runtime keyboard-only persona uses 0x0104')
    # Original startup copies/helpers and all original offsets are retained.
    if payload[0x1be98:0x1bff8]!=stock[0x1ce98:0x1cff8]:raise ValueError('Startup flash helpers changed')
    payload.extend(b'\xff'*(-len(payload)%8))
    header=bytearray(stock[:4096]);struct.pack_into('<II',header,12,len(payload),zlib.crc32(payload))
    binary=out/'AE64-Pro-XInput-FnRGB-EXPERIMENTAL-v0.3.bin';binary.write_bytes(header+payload)
    result={'status':'EXPERIMENTAL_UNTESTED_ON_HARDWARE','stock_sha256':STOCK_SHA,'image':binary.name,'image_bytes':binary.stat().st_size,'image_sha256':sha(binary.read_bytes()),'payload_bytes':len(payload),'payload_crc32':f'{zlib.crc32(payload):08x}','original_payload_bytes':original_length,'append_vma':hex(APPEND),'reserved_ram':[hex(0x8a960),hex(0x8b960)],'sections':sections,'symbols':symbols,'patches':patches,'build_command':command,'compiler_version':subprocess.check_output([zig,'version'],text=True).strip(),'verified':{'host_tests':False,'hardware_boot':False,'windows_xinput':False,'bootloader_acceptance':False,'flashed':False}}
    result['build_commands']=commands
    result['heap']={'original_begin':'0x87964','original_end':'0x8b964','new_end':'0x8a960','remaining_bytes':0x8a960-0x87964,'reserved_bytes':0x8b964-0x8a960}
    (out/'build-manifest.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print('Linked and packaged experimental image:',binary)
    print('Bytes:',binary.stat().st_size,'SHA256:',result['image_sha256'])
if __name__=='__main__':main()
