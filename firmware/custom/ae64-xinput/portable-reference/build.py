"""Compile/test portable components and archive RV32 objects; never flash a device."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zig',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--webdriver',type=Path,help='Repository root with tests/gamepad/protocol-tests.cjs')
    parser.add_argument('--node',default='node')
    args=parser.parse_args();root=Path(__file__).resolve().parent;out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    zig=str(args.zig.resolve());include=['-I',str(root/'include')]
    sources={name:root/'src'/name for name in ['ae64_gamepad.c','ae64_gamepad_physical.c','ae64_gamepad_protocol.c','ae64_xusb.c']}
    runs=[]
    def run(command):
        result=subprocess.run([str(x) for x in command],text=True,capture_output=True)
        if result.returncode:
            raise RuntimeError('Command failed: '+str(command)+'\n'+result.stdout+'\n'+result.stderr)
        runs.append({'command':[str(x) for x in command],'stdout':result.stdout,'stderr':result.stderr})
        if result.stdout:print(result.stdout.strip())
    version=subprocess.check_output([zig,'version'],text=True).strip()
    common=[zig,'cc','-std=c11','-Wall','-Wextra','-Werror','-O2',*include]
    tests=[('core',['ae64_gamepad.c'],'test_gamepad_review.c'),('physical',['ae64_gamepad.c','ae64_gamepad_physical.c'],'test_gamepad_physical.c'),('xusb',['ae64_gamepad.c','ae64_xusb.c'],'test_xusb.c')]
    if (root/'tests/test_gamepad_protocol_review.c').exists():tests.append(('protocol-review',['ae64_gamepad.c','ae64_gamepad_physical.c','ae64_gamepad_protocol.c'],'test_gamepad_protocol_review.c'))
    for label,names,test in tests:
        executable=out/(label+'.exe');run([*common,*[sources[n] for n in names],root/'tests'/test,'-o',executable]);run([executable])
    harness=out/'protocol-harness.exe'
    run([*common,sources['ae64_gamepad.c'],sources['ae64_gamepad_physical.c'],sources['ae64_gamepad_protocol.c'],root/'tests/protocol_harness.c','-o',harness])
    if args.webdriver:
        web=args.webdriver.resolve();run([args.node,web/'tests/gamepad/tests.cjs']);run([args.node,web/'tests/gamepad/protocol-tests.cjs',harness])
    objects=[]
    for name,source in sources.items():
        obj=out/(source.stem+'.rv32.o');run([zig,'cc','-target','riscv32-freestanding-none','-mcpu=generic_rv32+m+a+c','-mabi=ilp32','-ffreestanding','-fno-builtin','-Os','-Wall','-Wextra','-Werror',*include,'-c',source,'-o',obj]);objects.append(obj)
        data=obj.read_bytes()
        if data[:6]!=bytes.fromhex('7f454c460101') or int.from_bytes(data[18:20],'little')!=243:raise RuntimeError('Wrong ELF class/architecture')
    archive=out/'libae64_gamepad.rv32.a';run([zig,'ar','rcs',archive,*objects])
    evidence={'scope':'Portable component tests and RV32 static library, not a linked/flashable application','compiler':'Zig '+version,'runs':runs,'artifacts':[{'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [*objects,archive]]}
    (out/'build-results.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf8')
    print('PASS: portable components compiled/tested; RV32 library created. No firmware image generated.')

if __name__=='__main__':main()
