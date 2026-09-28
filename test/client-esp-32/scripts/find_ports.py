#!/usr/bin/env python3
"""Find the StoopNet test rig's serial ports and print them.

Devices are identified by USB identity so the flow works no matter which
order they were plugged in:

    heltec  CP210x bridge (Silicon Labs VID 10c4) — the StoopNet node(s)
    m5stick M5Stack USB serial (VID 0403, description "M5stack")
    esp32   other ESP32 boards: Espressif native USB (VID 303a) or a
            CH34x bridge (VID 1a86) — e.g. the plain dev-kit client

The full rig is four boards (two Heltec nodes, two clients). Boards of the
same kind are told apart by index, ordered by port path:

    find_ports.py --kind heltec --index 1     # the second Heltec

A --port argument (or STOOP_HELTEC_PORT / STOOP_M5_PORT / STOOP_ESP32_PORT,
plus numbered forms like STOOP_HELTEC2_PORT, in the environment) always wins
over auto-detection, so a rig with several boards attached can be pinned down
explicitly — run --list to see every port with its VID and serial number.
"""
import argparse
import os
import sys

# USB identities observed on this rig
HELTEC_VID = 0x10C4  # Silicon Labs CP210x
M5_VID = 0x0403  # FTDI VID reused by M5Stack's USB serial
M5_DESC = "m5stack"
ESP32_VIDS = (0x303A, 0x1A86)  # Espressif native USB, WCH CH34x

HINTS = {
    "heltec": "expected a CP210x bridge (VID 10c4) — is the Heltec plugged in?",
    "m5stick": "expected the M5Stack USB serial (description 'M5stack') — is the stick plugged in?",
    "esp32": "expected Espressif native USB (VID 303a) or CH34x (VID 1a86) — is the dev kit plugged in?",
}


def classify(port):
    desc = (port.description or "").lower()
    if port.vid == HELTEC_VID:
        return "heltec"
    if port.vid == M5_VID and M5_DESC in desc:
        return "m5stick"
    if port.vid in ESP32_VIDS:
        return "esp32"
    return None


def ports_of_kind(kind):
    """Every port of one kind, ordered by port path (index N = Nth entry)."""
    import serial.tools.list_ports

    return sorted((p for p in serial.tools.list_ports.comports()
                   if classify(p) == kind), key=lambda p: p.device)


def port_env_override(kind, index):
    prefix = f"STOOP_{kind.upper()}"
    numbered = os.environ.get(f"{prefix}{index + 1}_PORT")
    if numbered:
        return numbered
    return os.environ.get(f"{prefix}_PORT") if index == 0 else None


def find_port(kind, index=0):
    override = port_env_override(kind, index)
    if override:
        return override
    found = ports_of_kind(kind)
    if index < len(found):
        return found[index].device
    hint = HINTS.get(kind, "unknown kind")
    suffix = f" (index {index})" if index else ""
    raise SystemExit(f"cannot find the {kind} port{suffix}: {hint} "
                     f"(set STOOP_{kind.upper()}{index + 1 if index else ''}_PORT to pin it)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["heltec", "m5stick", "esp32"])
    ap.add_argument("--index", type=int, default=0,
                    help="Nth port of --kind (0-based), for rigs with several of a kind")
    ap.add_argument("--port", help="skip detection, print this instead")
    ap.add_argument("--list", action="store_true", help="print every recognized port")
    ap.add_argument("--count", action="store_true",
                    help="print how many ports match --kind (for ambiguity checks)")
    args = ap.parse_args()

    if args.count:
        print(len(ports_of_kind(args.kind)))
        return
    if args.list:
        import serial.tools.list_ports

        ports = sorted((p for p in serial.tools.list_ports.comports()
                        if classify(p)), key=lambda p: (classify(p), p.device))
        if not ports:
            print("no recognized serial devices")
        for kind in ("heltec", "m5stick", "esp32"):
            of_kind = [p for p in ports if classify(p) == kind]
            if not of_kind:
                print(f"{kind:8s} (not found)")
            for i, p in enumerate(of_kind):
                ident = (f"vid={p.vid:04x}"
                         + (f" serial={p.serial_number}" if p.serial_number else ""))
                print(f"{kind}[{i}]  {p.device:26s} {p.description}  ({ident})")
        return
    if args.kind is None:
        ap.error("--kind or --list is required")
    print(args.port or find_port(args.kind, args.index))


if __name__ == "__main__":
    main()
