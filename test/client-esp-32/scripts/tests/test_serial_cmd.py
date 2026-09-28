"""Host-side unit tests for serial_cmd.py (port discovery + CLI parsing).

Runs entirely on the host with mocked serial ports — no device needed:
    ./scripts/run.sh test
"""
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import serial_cmd as sc  # noqa: E402


def port(device, vid=None, description="n/a"):
    return SimpleNamespace(device=device, vid=vid, description=description)


class TestPortFiltering(unittest.TestCase):
    def test_known_vendors_cover_common_esp32_bridges(self):
        for vid, name in (("10c4", "CP210x"), ("1a86", "CH34x"),
                          ("0403", "FTDI"), ("303a", "Espressif native USB")):
            self.assertIn(vid, sc.KNOWN_VENDORS, name)

    def test_usb_ports_drop_legacy_ttys(self):
        fake = [port(f"/dev/ttyS{i}") for i in range(4)]
        fake.append(port("/dev/ttyUSB0", vid=0x10C4, description="CP2102"))
        with mock.patch("serial.tools.list_ports.comports",
                        return_value=list(fake)):
            found = sc._usb_ports()
        self.assertEqual([p.device for p in found], ["/dev/ttyUSB0"])

    def test_usb_ports_keep_vidless_acm(self):
        # Native-USB ESP32s (S3/C3) can enumerate without a bridge VID.
        fake = [port("/dev/ttyS0"), port("/dev/ttyACM0")]
        with mock.patch("serial.tools.list_ports.comports", return_value=fake):
            found = sc._usb_ports()
        self.assertEqual([p.device for p in found], ["/dev/ttyACM0"])


class TestPortSelection(unittest.TestCase):
    def test_prefers_known_vendor_bridge(self):
        fake = [port("/dev/ttyUSB1", description="generic"),
                port("/dev/ttyUSB0", vid=0x1A86, description="CH340")]
        with mock.patch.object(sc, "_usb_ports", return_value=fake):
            self.assertEqual(sc.find_port(), "/dev/ttyUSB0")

    def test_falls_back_to_any_usb_port(self):
        fake = [port("/dev/ttyACM0")]
        with mock.patch.object(sc, "_usb_ports", return_value=fake):
            self.assertEqual(sc.find_port(), "/dev/ttyACM0")

    def test_raises_when_no_ports(self):
        with mock.patch.object(sc, "_usb_ports", return_value=[]):
            with self.assertRaises(SystemExit):
                sc.find_port()

    def test_prefers_earliest_known_port_when_tied(self):
        fake = [port("/dev/ttyUSB7", vid=0x0403), port("/dev/ttyUSB2", vid=0x10C4)]
        with mock.patch.object(sc, "_usb_ports", return_value=fake):
            self.assertEqual(sc.find_port(), "/dev/ttyUSB2")


class TestCliParsing(unittest.TestCase):
    def test_default_command_is_help(self):
        args = sc.build_parser().parse_args([])
        self.assertEqual(args.command, ["help"])

    def test_command_words_are_kept(self):
        args = sc.build_parser().parse_args(["status"])
        self.assertEqual(args.command, ["status"])

    def test_quoted_style_single_command(self):
        args = sc.build_parser().parse_args(["run"])
        self.assertEqual(args.command, ["run"])

    def test_defaults(self):
        args = sc.build_parser().parse_args([])
        self.assertEqual(args.baud, 115200)
        self.assertEqual(args.wait, 4.0)
        self.assertIsNone(args.port)
        self.assertFalse(args.list)

    def test_port_baud_wait_overrides(self):
        args = sc.build_parser().parse_args(
            ["--port", "/dev/ttyUSB9", "--baud", "9600", "--wait", "2.5", "run"])
        self.assertEqual(args.port, "/dev/ttyUSB9")
        self.assertEqual(args.baud, 9600)
        self.assertEqual(args.wait, 2.5)
        self.assertEqual(args.command, ["run"])

    def test_list_flag(self):
        args = sc.build_parser().parse_args(["--list"])
        self.assertTrue(args.list)


if __name__ == "__main__":
    unittest.main()
