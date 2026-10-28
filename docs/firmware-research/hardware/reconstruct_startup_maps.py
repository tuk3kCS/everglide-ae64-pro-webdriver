from pathlib import Path
import re,json
import argparse
ap=argparse.ArgumentParser();ap.add_argument('analysis_directory',type=Path);ap.add_argument('--output',type=Path,default=Path('startup-memory-maps.json'));args=ap.parse_args()
base=0x80021000
out=[]
def val(s):return int(s,0)
def add(x,y):return (x+y)&0xffffffff
for f in sorted(args.analysis_directory.glob('*-disassembly.txt')):
 rows=[]
 for line in f.read_text().splitlines():
  m=re.match(r'([0-9a-f]+)\s+[0-9a-f]+\s+(\S+)\s*(.*)',line)
  if m:rows.append((int(m[1],16),m[2],m[3]))
 instr={r[0]:r for r in rows}
 regs={'zero':0}
 def simulate(r):
  off,op,args=r;p=[x.strip() for x in args.split(',') if x.strip()]
  if op=='auipc':regs[p[0]]=add(base+off,val(p[1])<<12)
  elif op in ('lui','c.lui'):regs[p[0]]=(val(p[1])<<12)&0xffffffff
  elif op=='addi':regs[p[0]]=add(regs[p[1]],val(p[2])) if p[1] in regs else None
  elif op=='c.addi':regs[p[0]]=add(regs[p[0]],val(p[1])) if regs.get(p[0]) is not None else None
  elif op in ('mv','c.mv'):regs[p[0]]=regs.get(p[1])
  elif op in ('li','c.li'):regs[p[0]]=val(p[1])&0xffffffff
  elif op=='sub':regs[p[0]]=(regs[p[1]]-regs[p[2]])&0xffffffff if regs.get(p[1]) is not None and regs.get(p[2]) is not None else None
  elif op=='c.sub':regs[p[0]]=(regs[p[0]]-regs[p[1]])&0xffffffff if regs.get(p[0]) is not None and regs.get(p[1]) is not None else None
 for r in rows:
  if r[0]>0x1c:break
  simulate(r)
 entry_regs={k:regs[k] for k in ['gp','tp','sp']}
 target=0x2a+val(instr[0x2a][2])
 calls=[]
 for r in rows:
  if r[0]<target:continue
  if r[0]>target+0x300:break
  off,op,arg=r
  if op in ('j','c.j','ret'):break
  if op=='jal':
   if arg.startswith('t0,'):continue
   calls.append({'call_payload_offset':off,'call_target_payload_offset':add(off,val(arg)),'destination':regs.get('a0'),'source_or_fill':regs.get('a1'),'length':regs.get('a2')})
   for reg in ['a0','a1','a2','a3','a4','a5','a6','a7','t0','t1','t2','t3','t4','t5','t6']:regs.pop(reg,None)
  else:simulate(r)
 out.append({'version':f.name.split('-')[0],'payload_vma':base,'startup_registers':entry_regs,'section_init_payload_offset':target,'section_init_calls':calls,'limits':'Argument reconstruction from inert linear disassembly. Section names inferred; no executed startup or full flash partition map.'})
 print(out[-1]['version'],entry_regs,'startup',hex(target))
 for c in calls:print({k:(hex(v) if isinstance(v,int) else v) for k,v in c.items()})
args.output.write_text(json.dumps(out,indent=2)+'\n')
