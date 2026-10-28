from pathlib import Path
import json,hashlib
root=Path('work/fn-rgb');root.mkdir(exist_ok=True)
p=Path('work/native/0.1.0.0.payload.bin').read_bytes()
q=json.loads(Path('work/native/0.1.0.0-disasm.json').read_text())['instructions']
ranges={'frame_merge_output':(0xa536,0xa6da),'frame_conversion':(0xa762,0xa880),'native_fn_renderer':(0x1456a,0x14906),'fn_press':(0x5906,0x5946),'fn_release':(0x5a56,0x5abe),'normal_action_resolve':(0x5b2c,0x5b9a),'led_cell_write':(0xa3b8,0xa3d8),'host_frame_read':(0xd300,0xd392),'os_handler':(0xbb14,0xbb94)}
for name,(a,b) in ranges.items():
 (root/(name+'.txt')).write_text('\n'.join(f"{x['off']:06x} {x['hex']:8} {x['mnemonic']:10} {x['operands']}" for x in q if a<=x['off']<b))
(root/'evidence.json').write_text(json.dumps({'payload_sha256':hashlib.sha256(p).hexdigest(),'payload_base':'0x80021000','hook':{'off':'0xA594','bytes':p[0xa594:0xa598].hex(),'native_target':'0x8003556A'},'ranges':{k:[hex(a),hex(b)] for k,(a,b) in ranges.items()}},indent=2))

