"""Host-side unit tests for the serial-log analyzer.

These run entirely on the host (no device needed):
    ./scripts/run.sh test
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import analyze_logs as al  # noqa: E402


def parse(text):
    return al.parse_lines(text)


def analyze(text, name="test.log"):
    return al.analyze(parse(text), name)


H = "[2026-09-04 12:00:00.000] "  # host-timestamp prefix as added by `capture`


class TestLineParsing(unittest.TestCase):
    def test_parses_plain_esp_line(self):
        (line,) = parse("I (12345) heartbeat: alive=true n=7")
        self.assertEqual(line.level, "I")
        self.assertEqual(line.uptime_ms, 12345)
        self.assertEqual(line.tag, "heartbeat")
        self.assertEqual(line.msg, "alive=true n=7")

    def test_parses_line_with_host_timestamp_prefix(self):
        (line,) = parse(H + "E (99) wifi: connect failed errno=104")
        self.assertEqual(line.host_ts, "2026-09-04 12:00:00.000")
        self.assertEqual(line.level, "E")
        self.assertEqual(line.uptime_ms, 99)
        self.assertEqual(line.tag, "wifi")

    def test_parses_all_five_levels(self):
        for level in "VDIWE":
            (line,) = parse(f"{level} (10) tag: msg")
            self.assertEqual(line.level, level)

    def test_strips_ansi_colors(self):
        (line,) = parse("\x1b[0;32mI (10) tag: green\x1b[0m")
        self.assertEqual(line.msg, "green")

    def test_handles_crlf(self):
        (line,) = parse("I (10) tag: msg\r\n")
        self.assertEqual(line.msg, "msg")

    def test_nonlog_lines_kept_as_raw(self):
        (line,) = parse("rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)")
        self.assertIsNone(line.level)
        self.assertIsNone(line.tag)
        self.assertIn("POWERON_RESET", line.raw)

    def test_blank_lines_dropped(self):
        self.assertEqual(len(parse("I (10) a: x\n\n   \nI (20) a: y\n")), 2)

    def test_timestamp_without_device_uptime(self):
        # Some ROM/bootloader lines have no "I (ms)" part.
        (line,) = parse(H + "ESP-ROM:esp32 Rev3")
        self.assertIsNone(line.uptime_ms)


class TestReport(unittest.TestCase):
    def test_empty_input_reports_error(self):
        rep = analyze("")
        self.assertIn("error", rep)

    def test_garbage_input_reports_error(self):
        rep = analyze("hello\nworld\n")
        self.assertIn("error", rep)

    def test_counts_by_level_and_tag(self):
        text = ("I (1) a: x\nI (2) a: y\nE (3) b: bad\nW (4) b: hmm\n")
        rep = analyze(text)
        self.assertEqual(rep["counts_by_level"], {"I": 2, "E": 1, "W": 1})
        self.assertEqual(rep["counts_by_tag_top20"]["a"], 2)
        self.assertEqual(rep["counts_by_tag_top20"]["b"], 2)

    def test_errors_and_warnings_listed(self):
        rep = analyze("E (1) wifi: fail errno=104\nW (2) wifi: retry 1\n")
        self.assertEqual(rep["errors"], ["wifi: fail errno=104"])
        self.assertEqual(rep["warnings"], ["wifi: retry 1"])

    def test_uptime_span_and_rate(self):
        text = "I (1000) a: x\nI (6000) a: y\nI (11000) a: z\n"
        rep = analyze(text)
        self.assertEqual(rep["device_uptime_span"]["first_ms"], 1000)
        self.assertEqual(rep["device_uptime_span"]["last_ms"], 11000)
        self.assertEqual(rep["device_uptime_span"]["span"], "0:10")
        self.assertGreater(rep["lines_per_device_second"], 0)

    def test_fmt_ms(self):
        self.assertEqual(al.fmt_ms(65000), "1:05")
        self.assertEqual(al.fmt_ms(3661000), "1:01:01")
        self.assertEqual(al.fmt_ms(0), "0:00")


class TestRestartsAndStalls(unittest.TestCase):
    def test_restart_detected_on_uptime_backwards(self):
        rep = analyze("I (30000) a: x\nI (500) a: fresh boot\n")
        self.assertEqual(rep["detected_restarts"], 1)

    def test_small_uptime_jitter_is_not_a_restart(self):
        rep = analyze("I (30000) a: x\nI (29800) a: y\nI (30200) a: z\n")
        self.assertEqual(rep["detected_restarts"], 0)

    def test_gap_over_5s_detected(self):
        rep = analyze("I (1000) a: x\nI (9000) a: y\n")
        self.assertEqual(len(rep["uptime_gaps_over_5s"]), 1)
        self.assertEqual(rep["uptime_gaps_over_5s"][0]["seconds"], 8.0)

    def test_no_gap_flagged_across_restart(self):
        # Uptime drops (restart), then continues normally: no stall to report.
        rep = analyze("I (30000) a: x\nI (500) a: boot\nI (1500) a: y\n")
        self.assertEqual(rep["uptime_gaps_over_5s"], [])


class TestMetrics(unittest.TestCase):
    METRICS = (
        "I (1000) METRICS: uptime_ms=1000|heap_free=100000|heap_min=100000|"
        "heap_largest=50000|tasks=6|cpu_mhz=240\n"
        "I (6000) METRICS: uptime_ms=6000|heap_free=99500|heap_min=99000|"
        "heap_largest=49000|tasks=6|cpu_mhz=240\n"
    )

    def test_series_extracted(self):
        rep = analyze(self.METRICS)
        heap = rep["metrics"]["heap_free"]
        self.assertEqual(heap["samples"], 2)
        self.assertEqual(heap["min"], 99500)
        self.assertEqual(heap["max"], 100000)
        self.assertEqual(heap["first"], 100000)
        self.assertEqual(heap["last"], 99500)

    def test_heap_leak_note_triggers(self):
        text = "".join(
            f"I ({i * 1000}) METRICS: uptime_ms={i * 1000}|heap_free={100000 - i * 1000}\n"
            for i in range(6))
        rep = analyze(text)
        self.assertIn("note", rep["metrics"]["heap_free"])
        self.assertIn("leak", rep["metrics"]["heap_free"]["note"].lower())

    def test_stable_heap_has_no_note(self):
        text = "".join(
            f"I ({i * 1000}) METRICS: uptime_ms={i * 1000}|heap_free=100000\n"
            for i in range(6))
        rep = analyze(text)
        self.assertNotIn("note", rep["metrics"]["heap_free"])

    def test_metrics_without_host_timestamp(self):
        # Raw monitor output (no `time` filter) must parse the same way.
        rep = analyze(self.METRICS.replace(H, ""))
        self.assertIn("heap_free", rep["metrics"])

    def test_normalize_masks_numbers_and_addresses(self):
        self.assertEqual(al.normalize("task 0xDEADBEEF at 42 ms"), "task 0xADDR at N ms")

    def test_top_messages_collapse_repeats(self):
        text = ("I (1) main: heartbeat|n=1\n"
                "I (2) main: heartbeat|n=2\n"
                "I (3) main: heartbeat|n=3\n")
        rep = analyze(text)
        top = rep["top_messages"][0]
        self.assertEqual(top["count"], 3)
        self.assertIn("heartbeat|n=N", top["msg"])


class TestSelftestLines(unittest.TestCase):
    def test_individual_and_suite_results_parsed(self):
        text = ("SELFTEST|name=level_roundtrip|result=PASS\n"
                "SELFTEST|name=uart_loopback|result=FAIL\n"
                "SELFTEST|suite=dr|failures=1|result=FAIL\n")
        rep = analyze(text)
        self.assertEqual(rep["selftests"]["suites"],
                         [{"suite": "dr", "failures": 1, "result": "FAIL"}])
        results = {t["name"]: t["result"] for t in rep["selftests"]["individual"]}
        self.assertEqual(results, {"level_roundtrip": "PASS", "uart_loopback": "FAIL"})

    def test_selftest_only_session_still_reported(self):
        # SELFTEST lines are plain printf (no esp_log prefix) — a capture with
        # only those must produce a report, not an "unrecognized" error.
        rep = analyze("SELFTEST|suite=dr|failures=0|result=PASS\n")
        self.assertNotIn("error", rep)
        self.assertEqual(rep["selftests"]["suites"][0]["result"], "PASS")


class TestJsonAndCli(unittest.TestCase):
    def test_report_is_json_serializable(self):
        rep = analyze("I (1) a: x\n" + TestMetrics.METRICS)
        data = json.loads(json.dumps(rep))
        for key in ("lines_total", "counts_by_level", "metrics", "top_messages"):
            self.assertIn(key, data)

    def _write(self, text):
        fd, path = tempfile.mkstemp(suffix=".log")
        with os.fdopen(fd, "w") as f:
            f.write(text)
        self.addCleanup(os.unlink, path)
        return path

    def test_cli_exit_code_1_when_errors_present(self):
        path = self._write("E (1) wifi: dead\n")
        script = Path(__file__).resolve().parents[1] / "analyze_logs.py"
        rc = subprocess.run([sys.executable, str(script), path],
                            capture_output=True).returncode
        self.assertEqual(rc, 1)

    def test_cli_exit_code_0_when_clean(self):
        path = self._write("I (1) main: all good\n")
        script = Path(__file__).resolve().parents[1] / "analyze_logs.py"
        rc = subprocess.run([sys.executable, str(script), path],
                            capture_output=True).returncode
        self.assertEqual(rc, 0)

    def test_cli_json_mode(self):
        path = self._write("I (1) main: all good\n")
        script = Path(__file__).resolve().parents[1] / "analyze_logs.py"
        out = subprocess.run([sys.executable, str(script), path, "--json"],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0)
        self.assertIn("counts_by_level", json.loads(out.stdout))


if __name__ == "__main__":
    unittest.main()
