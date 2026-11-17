import json,re
from pathlib import Path
q=json.loads(Path('work/native/0.1.0.0-disasm.json').read_text())['instructions']
for i,x in enumerate(q):
 t=x['operands'].split(',')[-1].strip()
 try: v=int(t,0)
 except: continue
 if x['mnemonic'] in ['jal','j','c.jal','c.j'] and x['off']+v in [0x12a18,0x12a42,0x12a6e]:
  print('\nTARGET',hex(x['off']+v))
  for y in q[max(0,i-8):i+2]: print(f"{y['off']:06x} {y['mnemonic']:9} {y['operands']}")
