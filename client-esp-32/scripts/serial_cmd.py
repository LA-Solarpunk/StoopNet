#!/usr/bin/env python3
"""Send one command to the tester's serial console and print the response.

Examples:
    serial_cmd.py --port /dev/cu.usbserial-X run
    serial_cmd.py --port /dev/cu.usbserial-X status
    serial_cmd.py --list
"""
import argparse
import sys
import time

# USB VID:PIDs of the serial bridges shipped on common ESP32 boards.
KNOWN_VENDORS = {
    "10c4": "CP210x (SiLabs)",
    "1a86": "CH34x (WCH)",
    "0403": "FTDI",
    "303a": "Espressif native USB",
    "2e8a": "Raspberry Pi Pico",
}


def _usb_ports():
    import serial.tools.list_ports

    out = []
    for p in serial.tools.list_ports.comports():
        # Skip the 30+ legacy /dev/ttyS* pseudo-ports; keep real USB serial.
        if p.vid or "USB" in p.device or "ACM" in p.device:
            out.append(p)
    return out


def list_ports():
    ports = _usb_ports()
    if not ports:
        print("no USB serial devices found (is the ESP32 plugged in?)")
        return
    for p in ports:
        note = KNOWN_VENDORS.get((p.vid and f"{p.vid:04x}") or "", "")
        print(f"{p.device:20s} {p.description}"
              + (f"  [{note}]" if note else ""))


def find_port():
    candidates = []
    for p in _usb_ports():
        vid = p.vid and f"{p.vid:04x}"
        prio = 0 if vid in KNOWN_VENDORS else 1
        candidates.append((prio, p.device))
    if not candidates:
        raise SystemExit(
            "no USB serial ports found — run ./scripts/run.sh detect")
    candidates.sort()
    return candidates[0][1]


def build_parser():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", nargs="*", default=["help"],
                    help="console command to send (default: help)")
    ap.add_argument("--port", help="serial port (default: auto-detect)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--wait", type=float, default=4.0,
                    help="seconds to keep reading after sending")
    ap.add_argument("--list", action="store_true", help="list ports and exit")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)

    if args.list:
        list_ports()
        return

    import serial
    from serial import SerialException

    port = args.port or find_port()
    cmd = " ".join(args.command)

    try:
        with serial.Serial(port, args.baud, timeout=0.25) as ser:
            time.sleep(0.3)  # let the ESP32's REPL prompt settle
            ser.reset_input_buffer()
            ser.write((cmd + "\n").encode())
            ser.flush()

            deadline = time.time() + args.wait
            quiet = 0.0
            out = bytearray()
            while time.time() < deadline and quiet < 1.0:
                chunk = ser.read(512)
                if chunk:
                    out += chunk
                    quiet = 0.0
                else:
                    quiet += 0.25
            sys.stdout.write(out.decode("utf-8", errors="replace"))
            sys.stdout.flush()
    except SerialException as e:
        print(f"serial error on {port}: {e}", file=sys.stderr)
        if "Permission denied" in str(e):
            print("hint: add yourself to the 'dialout' group "
                  "(sudo usermod -aG dialout $USER, then re-login)", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
