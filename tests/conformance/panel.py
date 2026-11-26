"""Check two compiled packages differing only in station.x on one running development firmware."""
import argparse
import json
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'firmware/player'))
from usb_player import Player

cli = argparse.ArgumentParser(description=__doc__)
cli.add_argument('port')
cli.add_argument('original', type=Path)
cli.add_argument('edited', type=Path)
cli.add_argument('--bench', action='store_true')
args = cli.parse_args()
fixture = json.loads((root/'tests/conformance/hemel.json').read_text())
before, after = (fixture['layoutEdit'][k] for k in ('originalX', 'editedX'))
with Player(args.port) as p:
    print(p.info, flush=True)
    for file, dx in [(args.original,0), (args.edited,after-before)]:
        print(p.load(file), flush=True)
        for f in fixture['frames']:
            line = p.command(f"SEEK {f['ms']}", 'TDP FRAME')
            expected = [f['ms'],f['berth'],f['x']+dx,f['y'],f['card'],f['entry'],
                        'down' if f['entry']>=0 else '-',int(f['entry']>=0)]
            if line.split()[2:-1] != list(map(str,expected)):
                raise ValueError(f'{line} (expected {expected})')
            print(line, flush=True)
        p.command('SEEK 90000','TDP FRAME')
        for x, colour in [(before, '1144' if dx else 'fe4c'), (after, 'fe4c' if dx else '1144')]:
            # Sample the badge interior above the rail, clear of text glyphs.
            line = p.command(f'PIXEL {x-22} 361','TDP PIXEL')
            if line.split()[-1] != colour:
                raise ValueError(f'Pixel at {x-22},361: {line} (expected {colour})')
            print(f'{x-22},361 {line}', flush=True)
    if args.bench:
        print(p.command('BENCH', 'TDP BENCH OK', 40), flush=True)
        print(p.command('BENCH TLS', 'TDP BENCH OK', 100), flush=True)
    print(p.command('INFO','TDP INFO'), flush=True)
