"""Read Windows XInput controller slots. No keyboard writes or flashing."""
import ctypes,time
from ctypes import wintypes

class Gamepad(ctypes.Structure):
    _fields_=[('buttons',wintypes.WORD),('lt',ctypes.c_ubyte),('rt',ctypes.c_ubyte),('lx',ctypes.c_short),('ly',ctypes.c_short),('rx',ctypes.c_short),('ry',ctypes.c_short)]
class State(ctypes.Structure):
    _fields_=[('packet',wintypes.DWORD),('pad',Gamepad)]
def main():
    dll=ctypes.WinDLL('xinput1_4.dll',winmode=0x800)
    get=dll.XInputGetState;get.argtypes=[wintypes.DWORD,ctypes.POINTER(State)];get.restype=wintypes.DWORD
    print('Reading native XInput slots 0-3. Ctrl+C to stop. Disconnect other controllers to identify the keyboard.')
    previous={}
    try:
        while True:
            for slot in range(4):
                state=State();status=get(slot,ctypes.byref(state))
                if status==0:
                    p=state.pad;value=(p.buttons,p.lt,p.rt,p.lx,p.ly,p.rx,p.ry)
                    if previous.get(slot)!=value:
                        print(f'Slot {slot}: buttons={p.buttons:04X} LT={p.lt:3} RT={p.rt:3} L=({p.lx:6},{p.ly:6}) R=({p.rx:6},{p.ry:6})',flush=True)
                    previous[slot]=value
                elif previous.get(slot)!='disconnected':
                    print(f'Slot {slot}: disconnected (status {status})',flush=True);previous[slot]='disconnected'
            time.sleep(0.05)
    except KeyboardInterrupt:pass
if __name__=='__main__':main()
