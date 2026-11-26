"""Reproduce the desktop storage measurement from pack-art.py's indexed raster."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib

def pack(directory, output):
    metadata = (directory / 'art.inc').read_text()
    width, height = map(int, re.search(r'rasterW=(\d+), rasterH=(\d+)', metadata).groups())
    raw = (directory / 'terrain.bin').read_bytes()
    if len(raw) != width * height:
        raise ValueError('Indexed raster dimensions disagree with art.inc')
    index, data = bytearray(), bytearray()
    max_tile = 0
    for y in range(0, height, 128):
        for x in range(0, width, 128):
            w, h = min(128, width-x), min(128, height-y)
            tile = b''.join(raw[row*width+x:row*width+x+w] for row in range(y, y+h))
            stream = zlib.compress(tile, level=6)
            if zlib.decompress(stream) != tile:
                raise ValueError(f'Tile at {x},{y} did not round-trip')
            index.extend(struct.pack('<II', len(data), len(stream)))
            data.extend(stream)
            max_tile = max(max_tile, len(tile))
    if output:
        output.write_bytes(index + data)
    print(json.dumps(dict(platform='desktop', codec='zlib-6', zlib=zlib.ZLIB_RUNTIME_VERSION,
                          raw_sha256=hashlib.sha256(raw).hexdigest(), width=width, height=height,
                          raw_bytes=len(raw), tiles=len(index)//8, index_bytes=len(index),
                          compressed_bytes=len(data), total_bytes=len(index)+len(data),
                          max_decoded_tile_bytes=max_tile), indent=2))

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--assets', type=Path, default=Path(__file__).resolve().parent/'generated')
    cli.add_argument('--output', type=Path, help='Write the index and tile streams for the board benchmark')
    args = cli.parse_args()
    pack(args.assets, args.output)
