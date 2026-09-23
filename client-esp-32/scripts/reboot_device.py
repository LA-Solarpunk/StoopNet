#!/usr/bin/env python3
"""Hard-reset a device over its USB serial port (RTS -> EN pulse).

    reboot_device.py --port /dev/cu.usbserial-0001

DTR is dropped first so IO0 stays high and the chip boots the app instead of
the download mode (the classic "waiting for download" trap).
"""
import argparse
import sys
import time


def reboot(port, baud=115200):
    import serial

    ser = serial.Serial()
    ser.port = port
    ser.baudrate = baud
    ser.timeout = 0.5
    ser.open()
    try:
        # settle both lines low: no download-mode strap, EN released
        ser.dtr = False
        ser.rts = False
        time.sleep(0.1)
        ser.rts = True  # assert reset
        time.sleep(0.1)
        ser.rts = False  # release -> fresh boot of the application
    finally:
        ser.close()
    print(f"rebooted {port}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True)
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()
    try:
        reboot(args.port, args.baud)
    except Exception as e:  # noqa: BLE001 — report any serial-layer failure
        print(f"reboot failed on {args.port}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
