from pathlib import Path
import re,struct,json
import argparse
a=argparse.ArgumentParser();a.add_argument('firmware_dir',type=Path);a.add_argument('--output',type=Path,default=Path('hpm_mmio_candidate_matches.json'));args=a.parse_args()
s=(Path(__file__).parent/'source-snapshots/hpm_soc_ip.h').read_text(encoding='utf8')
regs=dict(re.findall(r'#define (HPM_\w+_BASE) \(0x([0-9A-Fa-f]+)UL\)',s))
rows=[]
for f in sorted(args.firmware_dir.glob('*.bin')):
 b=f.read_bytes()[4096:];found=[]
 for name,h in regs.items():
  value=int(h,16);offs=[]
  for off in range(0,len(b)-3,2):
   w=struct.unpack_from('<I',b,off)[0]
   if w&127==0x37 and w&0xfffff000==value&0xfffff000:offs.append(f'0x{off:05x}')
  if offs:found.append({'name':name,'upper20_hex':f'{value&0xfffff000:08X}','lui_candidate_payload_offsets':offs})
 rows.append({'firmware':f.name,'matched_hpm_base_upper20':found})
 for r in found:
  if any(k in r['name'] for k in ['USB','ADC','GPIO','IOC','SYSCTL','PLL','PLIC']):print(f.name,r)
args.output.write_text(json.dumps(rows,indent=2))
