"""Inspect the running panel over its existing local UART. Requires pyserial."""
import argparse
from pathlib import Path
import time
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('port')
parser.add_argument('--capture', type=Path, help='Write a quarter-size physical framebuffer as a PPM')
parser.add_argument('--tap', type=int, nargs=2, metavar=('X', 'Y'), help='Exercise the UI at raw panel coordinates')
parser.add_argument('--watch', type=int, default=0, help='Watch application diagnostics for this many seconds')
mode = parser.add_mutually_exclusive_group()
mode.add_argument('--hold', type=int, choices=range(1, 61), metavar='SECONDS',
                  help='Pause presentation for 1 to 60 seconds, then restore touch and rendering')
mode.add_argument('--run',action='store_true',help='Resume normal rendering')
args = parser.parse_args()

port = serial.Serial(baudrate=115200, timeout=.4, exclusive=True)
port.dtr = port.rts = False
port.port = args.port
with port:
    def command(cmd, expected, timeout=6):
        port.write((cmd+'\n').encode())
        retry = time.monotonic()+1.5
        end = time.monotonic()+timeout
        while time.monotonic()<end:
            if cmd=='STATUS' and time.monotonic()>=retry:
                port.write(b'STATUS\n')
                retry=time.monotonic()+1.5
            line = port.readline().decode('ascii','replace').strip()
            if expected in line:
                return line
        raise SystemExit('Panel did not acknowledge '+cmd.split()[0])
    print(command('STATUS','LAKES_STATUS',14))
    if args.hold:
        try:
            held = command('HOLD','LAKES_HOLD')
            print(held, flush=True)
            if len(set(held.split()[-2:])) != 1:
                raise SystemExit('Display buffers differ while held')
            time.sleep(args.hold)
        finally:
            print(command('RUN','LAKES_RUN'))
    if args.run:
        print(command('RUN','LAKES_RUN'))
    if args.tap:
        print(command('TAP %d %d'%tuple(args.tap),'LAKES_TAP_OK'))
        time.sleep(.3)
    if args.capture:
        header = command('SHOT','LAKES_FRAME ')
        _, width, height = header[header.index('LAKES_FRAME'):].split()
        width, height = int(width), int(height)
        rows = {}
        end = time.monotonic()+35
        while time.monotonic()<end:
            line = port.readline().strip()
            if line==b'LAKES_FRAME_END':
                break
            if not line.startswith(b'LROW '):
                continue
            tag, y, data = line.split()
            raw = bytes.fromhex(data.decode())
            if len(raw)!=2*width:
                raise SystemExit('Incomplete framebuffer row')
            rgb=bytearray()
            for i in range(0,len(raw),2):
                v=(raw[i]<<8)|raw[i+1]
                rgb.extend(((v>>11)*255//31,((v>>5)&63)*255//63,(v&31)*255//31))
            rows[int(y)]=rgb
        if set(rows)!=set(range(height)):
            raise SystemExit(f'Incomplete capture ({len(rows)}/{height} rows)')
        args.capture.write_bytes(f'P6\n{width} {height}\n255\n'.encode()+b''.join(rows[i] for i in range(height)))
        print(args.capture)
    end = time.monotonic()+args.watch
    while time.monotonic()<end:
        line=port.readline().decode('ascii','replace').strip()
        if 'lakes:' in line or 'panic' in line.lower() or 'brownout' in line.lower():
            print(line,flush=True)
