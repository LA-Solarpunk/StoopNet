#!/usr/bin/env python3
"""Analyze a captured dr-esp32 serial log (run.sh capture -> run.sh analyze).

Understands three kinds of lines:
  * esp_log lines   "I (12345) tag: message"          (optional host-ts prefix,
                                                      ANSI colors stripped)
  * metrics lines   "I (12345) METRICS: key=value|…"
  * selftest lines  "SELFTEST|name=…|result=PASS"

The report covers: session span, counts by level/tag, every ERROR/WARN,
top repeated messages, device restarts, uptime gaps (stalls), a metrics
time-series summary with heap-trend (leak) detection and self-test results.
Use --json for machine-readable output.
"""
import argparse
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

HOST_TS = re.compile(
    r"^\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?\s*")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
# e.g. "I (12345) heartbeat: heartbeat|n=3|led=0|heap_free=198765"
ESP_LINE = re.compile(
    r"^([VDIWE])\s*\((\d+)\)\s*([A-Za-z0-9_.\-]+):\s?(.*)$")
# bootloader/ROM lines can look like "E (31) uart: ..." too; same shape.
METRICS_KEY = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=(-?[\d.]+(?:[eE]-?\d+)?)")
SELFTEST_LINE = re.compile(
    r"SELFTEST\|name=([A-Za-z0-9_]+)\|result=(PASS|FAIL)")
SELFTEST_SUITE = re.compile(r"SELFTEST\|suite=(\w+)\|failures=(\d+)\|result=(PASS|FAIL)")


class Line:
    __slots__ = ("raw", "host_ts", "level", "uptime_ms", "tag", "msg")

    def __init__(self, raw, host_ts, level, uptime_ms, tag, msg):
        self.raw, self.host_ts = raw, host_ts
        self.level, self.uptime_ms = level, uptime_ms
        self.tag, self.msg = tag, msg


def parse_lines(text):
    lines = []
    for raw in text.splitlines():
        raw = ANSI.sub("", raw.rstrip())
        if not raw.strip():
            continue
        m = HOST_TS.match(raw)
        host_ts = m.group(1) if m else None
        rest = raw[m.end():] if m else raw
        m = ESP_LINE.match(rest)
        if m:
            level, up, tag, msg = m.groups()
            lines.append(Line(raw, host_ts, level, int(up), tag, msg))
        else:
            lines.append(Line(raw, host_ts, None, None, None, rest))
    return lines


def normalize(msg):
    """Collapse numbers/addresses so repeated instances group together."""
    msg = re.sub(r"0x[0-9a-fA-F]+", "0xADDR", msg)
    msg = re.sub(r"\b\d+\b", "N", msg)
    return msg[:120]


def fmt_ms(ms):
    s = ms / 1000.0
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{sec:02d}" if h else f"{m:d}:{sec:02d}"


def analyze(lines, path):
    log_lines = [l for l in lines if l.level]
    suites = [m.groups() for m in (SELFTEST_SUITE.match(l.raw.strip()) for l in lines) if m]
    tests = [(m.group(1), m.group(2))
             for m in (SELFTEST_LINE.match(l.raw.strip()) for l in lines) if m]

    if not log_lines:
        # A session can legitimately contain only console output (SELFTEST
        # lines are printf, not esp_log) — still report what we recognized.
        if suites or tests:
            return {"file": str(path), "lines_total": len(lines), "log_lines": 0,
                    "selftests": {
                        "suites": [{"suite": s, "failures": int(f), "result": r}
                                   for s, f, r in suites],
                        "individual": [{"name": n, "result": r} for n, r in tests]}}
        return {"error": ("no esp_log lines recognized — was this a capture "
                          "of device output? (lines seen: %d)" % len(lines))}

    uptimes = [l.uptime_ms for l in log_lines if l.uptime_ms is not None]
    by_level = Counter(l.level for l in log_lines)
    by_tag = Counter(l.tag for l in log_lines)
    errs = [l for l in log_lines if l.level == "E"]
    warns = [l for l in log_lines if l.level == "W"]

    report = {}
    report["file"] = str(path)
    report["lines_total"] = len(lines)
    report["log_lines"] = len(log_lines)
    if uptimes:
        report["device_uptime_span"] = {
            "first_ms": uptimes[0], "last_ms": uptimes[-1],
            "span": fmt_ms(uptimes[-1] - uptimes[0])}
        rate = len(log_lines) / max((uptimes[-1] - uptimes[0]) / 1000.0, 1e-9)
        report["lines_per_device_second"] = round(rate, 1)
    report["counts_by_level"] = dict(by_level)
    report["counts_by_tag_top20"] = dict(by_tag.most_common(20))

    report["errors"] = [f"{l.tag}: {l.msg}" for l in errs]
    report["warnings"] = [f"{l.tag}: {l.msg}" for l in warns[:50]]

    msgs = Counter(normalize(l.msg) for l in log_lines)
    report["top_messages"] = [
        {"count": c, "msg": m} for m, c in msgs.most_common(15)]

    # Restarts: uptime going backwards, or our boot banner appearing again.
    restarts = 0
    prev = None
    for l in log_lines:
        if l.uptime_ms is None:
            continue
        if prev is not None and l.uptime_ms < prev - 1500:
            restarts += 1
        prev = l.uptime_ms
    report["detected_restarts"] = restarts

    # Stalls: device logged nothing for > 5s of device uptime (excludes gaps
    # across a restart, already counted above).
    gaps = []
    prev = None
    for l in log_lines:
        if l.uptime_ms is None:
            continue
        if prev is not None and l.uptime_ms - prev > 5000 and l.uptime_ms >= prev:
            gaps.append({"from": fmt_ms(prev), "to": fmt_ms(l.uptime_ms),
                         "seconds": round((l.uptime_ms - prev) / 1000.0, 1)})
        prev = l.uptime_ms
    report["uptime_gaps_over_5s"] = gaps[:20]

    # Metrics time series (take the last value per uptime for dedup).
    series = defaultdict(list)
    for l in log_lines:
        if l.tag == "METRICS" or (l.msg and l.msg.startswith("uptime_ms=")):
            for k, v in METRICS_KEY.findall(l.msg):
                try:
                    series[k].append(float(v))
                except ValueError:
                    pass
    metrics = {}
    for k, vals in sorted(series.items()):
        if not vals:
            continue
        entry = {
            "samples": len(vals), "min": min(vals), "max": max(vals),
            "mean": round(statistics.fmean(vals), 1),
            "first": vals[0], "last": vals[-1]}
        entry["delta"] = vals[-1] - vals[0]
        if k == "heap_free" and len(vals) >= 4:
            half = max(len(vals) // 2, 1)
            first_half, second_half = vals[:half], vals[half:]
            trend = statistics.fmean(second_half) - statistics.fmean(first_half)
            entry["trend_per_half"] = round(trend, 1)
            if trend < -0.02 * max(abs(statistics.fmean(first_half)), 1):
                entry["note"] = ("heap is trending DOWN across the session — "
                                 "possible leak, watch heap_min")
        metrics[k] = entry
    report["metrics"] = metrics

    if suites or tests:
        report["selftests"] = {
            "suites": [{"suite": s, "failures": int(f), "result": r}
                       for s, f, r in suites],
            "individual": [{"name": n, "result": r} for n, r in tests]}

    return report


def print_report(rep):
    if "error" in rep:
        print(f"!! {rep['error']}")
        return
    print(f"dr-esp32 log analysis — {rep['file']}")
    print(f"  lines: {rep['log_lines']} log / {rep['lines_total']} total"
          + (f", device span {rep['device_uptime_span']['span']}" if "device_uptime_span" in rep else ""))
    if "lines_per_device_second" in rep:
        print(f"  rate:  {rep['lines_per_device_second']} lines/device-second")
    lv = rep.get("counts_by_level", {})
    if lv:
        print("  levels: " + "  ".join(f"{k}={v}" for k, v in sorted(lv.items())))
    if rep.get("detected_restarts"):
        print(f"  restarts detected: {rep['detected_restarts']}")
    if rep.get("uptime_gaps_over_5s"):
        print("  stalls (no logs for >5s):")
        for g in rep["uptime_gaps_over_5s"]:
            print(f"    {g['from']} -> {g['to']}  ({g['seconds']}s)")
    if rep.get("errors"):
        print("  ERRORS:")
        for e in rep["errors"][:30]:
            print(f"    E {e}")
    if rep.get("warnings"):
        print(f"  WARNINGS ({len(rep['warnings'])} shown):")
        for w in rep["warnings"][:20]:
            print(f"    W {w}")
    if rep.get("top_messages"):
        print("  most frequent messages:")
        for t in rep["top_messages"][:10]:
            print(f"    {t['count']:5d}x {t['msg']}")
    if rep.get("metrics"):
        print("  metrics time-series:")
        for k, e in rep["metrics"].items():
            print(f"    {k:14s} n={e['samples']:3d}  min={e['min']:.0f}  "
                  f"max={e['max']:.0f}  mean={e['mean']:.0f}  "
                  f"first={e['first']:.0f}  last={e['last']:.0f}")
            if "note" in e:
                print(f"      ! {e['note']}")
    if rep.get("selftests"):
        st = rep["selftests"]
        for s in st.get("suites", []):
            print(f"  selftest suite '{s['suite']}': {s['result']} "
                  f"({s['failures']} failures)")
        for t in st.get("individual", []):
            print(f"    {t['result']}  {t['name']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("logfile", help="captured log file (default: newest logs/session_*.log)")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = ap.parse_args()

    path = Path(args.logfile)
    if not path.exists():
        raise SystemExit(f"no such file: {path}")
    lines = parse_lines(path.read_text(encoding="utf-8", errors="replace"))
    rep = analyze(lines, path)
    if args.json:
        print(json.dumps(rep, indent=2))
    else:
        print_report(rep)
        bad = rep.get("counts_by_level", {}).get("E", 0)
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
