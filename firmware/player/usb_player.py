"""Load a development package or control replay on the CrowPanel over USB."""
import argparse
from pathlib import Path
import time
import serial

class Player:
    def __init__(self, port):
        self.uart = serial.Serial(baudrate=115200, timeout=.4, write_timeout=10, exclusive=True)
        self.uart.port = port
        self.uart.dtr = self.uart.rts = False

    def __enter__(self):
        self.uart.open()
        try:
            for _ in range(15):
                self.send('INFO')
                try:
                    self.info = self.wait('TDP INFO', 2, syncing=True)
                    return self
                except TimeoutError:
                    pass
            raise TimeoutError('Development player did not answer INFO')
        except BaseException:
            self.uart.close()
            raise

    def __exit__(self, *args):
        self.uart.close()

    def send(self, line):
        self.uart.write((line+'\n').encode('ascii'))

    def wait(self, prefix, timeout=8, syncing=False):
        end = time.monotonic()+timeout
        while time.monotonic() < end:
            line = self.uart.readline().decode('ascii', 'replace').strip()
            if not syncing and line.startswith('TDP ERROR'):
                raise RuntimeError(line)
            if line.startswith(prefix):
                return line
            if line.startswith(('TDP MEM', 'TDP DRAW')):
                print(line, flush=True)
        raise TimeoutError(prefix)

    def command(self, line, expected, timeout=8):
        self.send(line)
        return self.wait(expected, timeout)

    def load(self, path):
        data = path.read_bytes()
        if not 52 <= len(data) <= 65536:
            raise ValueError('Package must be 52 to 65,536 bytes')
        self.command(f'LOAD {len(data)}', 'TDP READY')
        self.uart.write(data)
        return self.wait('TDP LOADED')

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('port')
    cli.add_argument('package', type=Path, nargs='?')
    cli.add_argument('--seek', type=int, metavar='MS')
    cli.add_argument('--play', action='store_true')
    cli.add_argument('--pixel', type=int, nargs=2, metavar=('X','Y'))
    cli.add_argument('--bench', choices=['draw','tls'])
    args = cli.parse_args()
    with Player(args.port) as p:
        print(p.info)
        if args.package:
            print(p.load(args.package))
        if args.seek is not None:
            print(p.command(f'SEEK {args.seek}', 'TDP FRAME'))
        if args.pixel:
            print(p.command('PIXEL %d %d'%tuple(args.pixel), 'TDP PIXEL'))
        if args.bench:
            print(p.command('BENCH TLS' if args.bench=='tls' else 'BENCH', 'TDP BENCH OK', 100))
        if args.play:
            print(p.command('PLAY', 'TDP PLAYING'))
