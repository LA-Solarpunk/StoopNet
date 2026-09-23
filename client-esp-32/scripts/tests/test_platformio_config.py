"""Host-side tests for platformio.ini — locks the tester env to the rig.

The client must associate with the node's softAP exactly as the StoopNet
firmware configures it: SSID "Neighborhood Board (free)" self-assigned to
8.8.8.8 (see examples/stoop_net_radio/main.cpp in the parent repo). A wrong
SSID or host makes every suite run fail with "no AP" — a wrong LED GPIO just
blinks in the dark — so these tests fail the suite before anything gets
flashed. Runs on the host, no device needed:
    ./scripts/run.sh test
"""
import configparser
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INI = os.path.join(ROOT, "platformio.ini")

# Must match the StoopNet node firmware (parent repo, [stoop_radio_base]):
# SSID "Neighborhood Board (free)", softAP self-assigned to 8.8.8.8.
# Red LED on M5StickC and M5StickC Plus alike (active low).
LED_GPIO = "10"


CP = configparser.ConfigParser()
CP.optionxform = str  # keep option case
CP.read(INI)


def cfg_value(value):
    """Strip ini quoting that exists only to protect inner quotes."""
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1]
    return value


def cfg(section, key):
    """Read one key with inline `;` comments and outer quoting stripped."""
    return cfg_value(CP[section][key].split(";", 1)[0].strip())


def flags(env):
    out = []
    for line in CP[env]["build_flags"].splitlines():
        line = line.split(";", 1)[0].strip()  # configparser keeps inline comments
        if line:
            out.append(line)
    return out


def flag_value(flag_list, name):
    # accept both `-DNAME=value` and `-D NAME = value` spellings
    pat = re.compile(r"^-D\s*" + re.escape(name) + r"\s*=\s*(.*)$")
    for f in flag_list:
        m = pat.match(f)
        if m:
            return cfg_value(m.group(1).strip())
    return None


class TestPlatformioIni(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert "env:m5stick-tester" in CP.sections(), (
            "env:m5stick-tester missing from platformio.ini")
        cls.flags = flags("env:m5stick-tester")

    def test_tester_is_the_default_env(self):
        self.assertEqual(cfg("platformio", "default_envs"), "m5stick-tester")

    def test_targets_the_m5stick(self):
        self.assertEqual(cfg("env:m5stick-tester", "framework"), "arduino")
        # PICO-D4 board json fits both StickC revisions
        self.assertEqual(cfg("env:m5stick-tester", "board"), "m5stick-c")

    def test_only_the_tester_sources_build(self):
        filt = CP["env:m5stick-tester"]["build_src_filter"].split()
        self.assertEqual(filt, ["+<tester/*>"])

    def test_join_parameters_match_the_node(self):
        # the inner double quotes are the C string literal — they must survive
        self.assertEqual(flag_value(self.flags, "STOOP_TEST_SSID"),
                         '"Neighborhood Board (free)"')
        self.assertEqual(flag_value(self.flags, "STOOP_TEST_HOST"), '"8.8.8.8"')

    def test_led_gpio_and_build_label(self):
        self.assertEqual(flag_value(self.flags, "TESTER_LED_GPIO"), LED_GPIO)
        self.assertIsNotNone(flag_value(self.flags, "TESTER_BUILD_LABEL"),
                             "TESTER_BUILD_LABEL must have a default; "
                             "test_flow.sh overrides it per build")

    def test_serial_monitor_speed_unchanged(self):
        self.assertEqual(cfg("env:m5stick-tester", "monitor_speed"), "115200")

    def test_panic_backtraces_decode_in_monitor_and_captures(self):
        self.assertIn("esp32_exception_decoder",
                      cfg("env:m5stick-tester", "monitor_filters"))


if __name__ == "__main__":
    unittest.main()
