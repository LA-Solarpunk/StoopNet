#!/usr/bin/env python3
"""Summarize a stoop-tester capture: print each SELFTEST line's verdict.

    summarize_tests.py logs/flow_20260918_124500.log

Exit code 0 only when the suite summary line
    SELFTEST|suite=stoop_tester|failures=0|result=PASS
is present, so the test flow (and CI) can gate on it.
"""
import re
import sys

TEST_RE = re.compile(r"SELFTEST\|name=([A-Za-z0-9_]+)\|result=(PASS|FAIL)\|ms=(\d+)\|(.*)")
SUITE_RE = re.compile(r"SELFTEST\|suite=(\w+)\|failures=(\d+)\|result=(PASS|FAIL)")
BOOT_RE = re.compile(r"STOOPTESTER\|fw=([^|]+)\|ssid=([^|]+)\|host=([^|]+)\|mac=([^|]+)")


def main(argv=None):
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2

    boot = None
    tests = []
    suite = None
    with open(args[0], "r", errors="replace") as f:
        for line in f:
            line = line.strip()
            m = BOOT_RE.search(line)
            if m and boot is None:
                boot = m.groups()
            m = TEST_RE.match(line)
            if m:
                tests.append(m.groups())
            m = SUITE_RE.match(line)
            if m:
                suite = m.groups()

    if boot:
        print(f"tester firmware: {boot[0]}  (mac {boot[3]}, target {boot[2]} ssid '{boot[1]}')")
    for name, result, ms, note in tests:
        mark = "ok  " if result == "PASS" else "FAIL"
        print(f"  [{mark}] {name:26s} {ms:>6s} ms  {note}")

    if not suite:
        print("NO SUITE RESULT — the tester never finished (device missing, AP down, "
              "or capture too short?)")
        return 1

    name, failures, result = suite
    print(f"suite {name}: {result} ({failures} failure(s))")
    return 0 if result == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
