#!/usr/bin/env python3
"""Find the StoopNet test rig's serial ports and print them.

Both devices are identified by USB identity so the flow works no matter
which order they were plugged in:

    heltec  CP210x bridge (Silicon Labs VID 10c4) — the StoopNet node
    m5stick M5Stack USB serial (VID 0403, description "M5stack")

Usage:
    find_ports.py --kind heltec [--port /dev/cu.usbserial-XXXX]
    find_ports.py --list

A --port argument (or STOOP_HELTEC_PORT / STOOP_M5_PORT in the environment)
always wins over auto-detection, so a rig with several boards attached can
be pinned down explicitly.
"""
import argparse
import os
import sys

# USB identities observed on this rig
HELTEC_VID = 0x10C4  # Silicon Labs CP210x
M5_VID = 0x0403  # FTDI VID reused by M5Stack's USB serial
M5_DESC = "m5stack"


def classify(port):
    desc = (port.description or "").lower()
    if port.vid == HELTEC_VID:
        return "heltec"
    if port.vid == M5_VID and M5_DESC in desc:
        return "m5stick"
    return None


def all_ports():
    import serial.tools.list_ports

    found = {}
    for p in serial.tools.list_ports.comports():
        kind = classify(p)
        if kind and kind not in found:  # first match wins; override via env/--port
            found[kind] = p.device
    return found


def find_port(kind):
    override = os.environ.get("STOOP_HELTEC_PORT" if kind == "heltec" else "STOOP_M5_PORT")
    if override:
        return override
    found = all_ports()
    if kind in found:
        return found[kind]
    hint = {
        "heltec": "expected a CP210x bridge (VID 10c4) — is the Heltec plugged in?",
        "m5stick": "expected the M5Stack USB serial (description 'M5stack') — is the stick plugged in?",
    }[kind]
    raise SystemExit(f"cannot find the {kind} port: {hint} "
                     f"(set STOOP_{kind.upper()}_PORT to pin it)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["heltec", "m5stick"])
    ap.add_argument("--port", help="skip detection, print this instead")
    ap.add_argument("--list", action="store_true", help="print every recognized port")
    args = ap.parse_args()

    if args.list:
        found = all_ports()
        for kind in ("heltec", "m5stick"):
            print(f"{kind:8s} {found.get(kind, '(not found)')}")
        return
    if args.kind is None:
        ap.error("--kind or --list is required")
    print(args.port or find_port(args.kind))


if __name__ == "__main__":
    main()
