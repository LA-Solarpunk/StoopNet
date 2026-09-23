#!/usr/bin/env python3
"""Capture serial output until a marker line appears (or a timeout).

Used by the test flow to listen to the M5Stick while its suite runs:

    capture_until.py --port /dev/cu.usbserial-X --out logs/s.log \
        --stop "SELFTEST\\|suite=" --timeout 150

Every byte read is echoed to stdout and appended to --out, so the file can
be fed to analyze_logs.py afterwards. Exits 0 if the stop pattern was seen,
1 on timeout, 2 on serial trouble.
"""
import argparse
import re
import sys
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True)
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--reset", action="store_true",
                    help="hard-reset the device (RTS pulse) right after opening the port")
    ap.add_argument("--out", help="also write everything to this file")
    ap.add_argument("--stop", help="regex; stop reading once it matches a line")
    ap.add_argument("--timeout", type=float, default=120.0,
                    help="give up after this many seconds (default 120)")
    ap.add_argument("--quiet-exit", type=float, default=8.0,
                    help="also stop after this many silent seconds (0=never)")
    args = ap.parse_args()

    import serial
    from serial import SerialException

    stop_re = re.compile(args.stop) if args.stop else None
    out = open(args.out, "ab") if args.out else None
    try:
        ser = serial.Serial(args.port, args.baud, timeout=0.25)
    except SerialException as e:
        print(f"serial error on {args.port}: {e}", file=sys.stderr)
        return 2

    if args.reset:
        # fresh boot under capture: drop DTR (keep IO0 high so the app boots,
        # not the download mode), then pulse RTS into EN
        ser.dtr = False
        ser.rts = False
        time.sleep(0.1)
        ser.rts = True
        time.sleep(0.1)
        ser.rts = False

    deadline = time.time() + args.timeout
    quiet = 0.0
    matched = False
    try:
        while time.time() < deadline:
            chunk = ser.read(512)
            if not chunk:
                quiet += 0.25
                if args.quiet_exit and quiet >= args.quiet_exit and matched:
                    break  # pattern already seen and the device went quiet
                continue
            quiet = 0.0
            text = chunk.decode("utf-8", errors="replace")
            sys.stdout.write(text)
            sys.stdout.flush()
            if out:
                out.write(chunk)
                out.flush()
            if stop_re:
                for line in text.replace("\r", "\n").split("\n"):
                    if stop_re.search(line):
                        matched = True
                        # keep draining briefly so the summary line itself
                        # and the device's final log make it into the capture
                        grace = time.time() + 2.0
                        while time.time() < grace:
                            tail = ser.read(256)
                            if tail:
                                sys.stdout.write(tail.decode("utf-8", errors="replace"))
                                sys.stdout.flush()
                                if out:
                                    out.write(tail)
                                    out.flush()
                        return 0
    except SerialException as e:
        print(f"\nserial error on {args.port}: {e}", file=sys.stderr)
        return 2
    finally:
        ser.close()
        if out:
            out.close()
    return 0 if matched else 1


if __name__ == "__main__":
    sys.exit(main())
