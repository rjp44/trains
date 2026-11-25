"""Save credentials in the Hemel firmware's NVS namespace over local USB."""
import argparse
from getpass import getpass
import time
import serial


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port")
    args = parser.parse_args()
    ssid = getpass("Wi-Fi SSID (hidden): ").encode()
    password = getpass("Wi-Fi passphrase (hidden, blank for open): ").encode()
    if not 1 <= len(ssid) <= 32 or (password and not 8 <= len(password) <= 63):
        parser.error("Use a 1–32 byte SSID and an 8–63 byte passphrase, or blank for open.")
    port = serial.Serial(baudrate=115200, timeout=0.5, write_timeout=2, exclusive=True)
    port.dtr = port.rts = False
    port.port = args.port
    with port:
        port.reset_input_buffer()
        port.write(f"\nW1\t{ssid.hex()}\t{password.hex()}\n".encode("ascii"))
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            line = port.readline().strip()
            if line == b"HEMEL_WIFI_SAVED":
                print("Saved. Restart the panel to connect.")
                return
            if line == b"HEMEL_WIFI_INVALID":
                break
    raise SystemExit("Panel did not confirm saving the credentials.")


if __name__ == "__main__":
    main()
