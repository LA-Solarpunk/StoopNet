"""Host-side unit tests for the StoopNet flow helpers (verdict + port picking).

Runs entirely on the host — no device needed:
    ./scripts/run.sh test
"""
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import summarize_tests as st  # noqa: E402
import find_ports as fp  # noqa: E402


class TestSummarize(unittest.TestCase):
    def run_main(self, text):
        path = os.path.join(self.tmp, "capture.log")
        with open(path, "w") as f:
            f.write(text)
        return st.main([path])

    def setUp(self):
        self.tmp = os.environ.get("TMPDIR", "/tmp")

    ALL_PASS = (
        "STOOPTESTER|fw=abc1234|ssid=Neighborhood Board (free)|host=8.8.8.8|mac=AA:BB\r\n"
        "SELFTEST|name=ap_connect|result=PASS|ms=618|ssid=x rssi=-36\r\n"
        "SELFTEST|suite=stoop_tester|failures=0|result=PASS\r\n")

    def test_all_pass_is_exit_zero(self):
        self.assertEqual(self.run_main(self.ALL_PASS), 0)

    def test_one_failure_is_exit_one(self):
        text = self.ALL_PASS.replace(
            "name=ap_connect|result=PASS", "name=ap_connect|result=FAIL"
        ).replace("failures=0", "failures=1").replace("|result=PASS\r\n", "|result=FAIL\r\n")
        self.assertEqual(self.run_main(text), 1)

    def test_missing_suite_is_exit_one(self):
        text = "SELFTEST|name=ap_connect|result=PASS|ms=10|x\r\n"
        self.assertEqual(self.run_main(text), 1)

    def test_empty_capture_is_exit_one(self):
        self.assertEqual(self.run_main(""), 1)

    def test_boot_line_is_reported(self):
        # just checks parsing doesn't choke on the banner alongside results
        self.assertEqual(self.run_main(self.ALL_PASS), 0)


class TestPortClassification(unittest.TestCase):
    def port(self, vid, description):
        return SimpleNamespace(device="/dev/cu.usbserial-X", vid=vid,
                               description=description)

    def test_heltec_is_silabs_cp210x(self):
        self.assertEqual(fp.classify(self.port(0x10C4, "CP2102 USB to UART")),
                         "heltec")

    def test_m5stick_is_m5stack_descriptor_on_ftdi_vid(self):
        self.assertEqual(fp.classify(self.port(0x0403, "M5stack")), "m5stick")

    def test_unknown_devices_are_ignored(self):
        self.assertIsNone(fp.classify(self.port(0x0403, "FT230X Basic UART")))
        self.assertIsNone(fp.classify(self.port(None, "Bluetooth-Incoming")))

    def test_first_match_wins(self):
        fake = [self.port(0x10C4, "CP2102"), self.port(0x0403, "M5stack")]
        with mock.patch("serial.tools.list_ports.comports", return_value=fake):
            self.assertEqual(fp.all_ports(),
                             {"heltec": "/dev/cu.usbserial-X",
                              "m5stick": "/dev/cu.usbserial-X"})


if __name__ == "__main__":
    unittest.main()
