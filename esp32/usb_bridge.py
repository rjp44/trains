"""Run the Hemel bridge on a Mac or Linux host with a USB serial connection."""

import argparse
import os
from pathlib import Path
import select
import subprocess
import sys
import time

import serial


def relay(device, bridge_args):
    # Set the modem lines before opening. ESP development boards often use
    # these lines as reset and boot-mode inputs.
    port = serial.Serial(baudrate=115200, timeout=0, write_timeout=2, exclusive=True)
    port.dtr = port.rts = False
    port.port = device
    with port:
        print(f"Connected to {port.name} at {port.baudrate}", file=sys.stderr)
        command = ["node", str(Path(__file__).with_name("bridge.mjs")), *bridge_args]
        with subprocess.Popen(command, stdout=subprocess.PIPE) as bridge:
            try:
                while True:
                    ready, _, _ = select.select([port, bridge.stdout], [], [])
                    if port in ready:
                        data = port.read(4096)
                        if data:
                            sys.stderr.buffer.write(data)
                            sys.stderr.buffer.flush()
                    if bridge.stdout in ready:
                        data = os.read(bridge.stdout.fileno(), 4096)
                        if not data:
                            port.flush()
                            return bridge.wait()
                        port.write(data)
            finally:
                if bridge.poll() is None:
                    bridge.terminate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="the board's USB serial device")
    parser.add_argument("--recording", choices=("sector", "hemel", "watford"))
    parser.add_argument("--at", type=float, default=0, help="start recording at this second")
    parser.add_argument("--once", action="store_true", help="send one snapshot and exit")
    args = parser.parse_args()
    bridge_args = ["--at", str(args.at)]
    if args.recording:
        bridge_args.extend(["--recording", args.recording])
    if args.once:
        bridge_args.append("--once")
    last_error = None
    while True:
        try:
            return relay(args.port, bridge_args)
        except serial.SerialException as error:
            if str(error) != last_error:
                print(error, file=sys.stderr)
                last_error = str(error)
            if args.once:
                return 1
            # Reopening this path starts a fresh bridge with a full snapshot.
            time.sleep(1)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
