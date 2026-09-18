#!/usr/bin/env bash
# StoopNet ESP32 test device — host-side CLI (wraps PlatformIO + the two-device flow).
#
#   ./scripts/run.sh build      compile the tester firmware
#   ./scripts/run.sh upload     flash the M5Stick (auto-detects the port)
#   ./scripts/run.sh monitor    interactive serial monitor
#   ./scripts/run.sh capture    monitor + save every line under logs/ (Ctrl-C stops)
#   ./scripts/run.sh analyze    report on the newest captured session (or a file)
#   ./scripts/run.sh test       host-side test suite (no device needed)
#   ./scripts/run.sh cmd "..."  send a console command to the tester (run|status|reboot|help)
#   ./scripts/run.sh detect     list serial ports + common access problems
#   ./scripts/run.sh clean      remove build artifacts
#
# StoopNet two-device test flow (Heltec node + M5Stick client):
#   ./scripts/run.sh ports      show where each device is attached
#   ./scripts/run.sh flow       flash both devices, reboot, run the WiFi suite
#   ./scripts/run.sh test-flow  re-run the suite without reflashing
#   ./scripts/run.sh reboot [heltec|tester|both]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${DR_PIO_VENV:-$HOME/.local/share/venvs/platformio}"
PY="$VENV/bin/python"
PIO="$VENV/bin/pio"

ensure_pio() {
    if [ ! -x "$PIO" ]; then
        echo "[run] PlatformIO not found — installing into $VENV ..."
        python3 -m venv "$VENV"
        "$VENV/bin/pip" install -q -U platformio
        echo "[run] done."
    fi
}

# Prefer an already-installed pio (DR_PIO_BIN, then $PATH); the private venv is
# the fallback. Host scripts need a python with pyserial — pio's own
# interpreter carries one, otherwise fall back to (installing) the venv.
if [ -n "${DR_PIO_BIN:-}" ]; then
    PIO="$DR_PIO_BIN"
elif command -v pio >/dev/null 2>&1; then
    PIO="$(command -v pio)"
else
    ensure_pio
fi
PIO_PY="$(head -1 "$PIO" | sed 's/^#!//')"
if [ -x "$PIO_PY" ] && "$PIO_PY" -c 'import serial' >/dev/null 2>&1; then
    PY="$PIO_PY"
else
    ensure_pio
    PY="$VENV/bin/python"
fi

latest_log() {
    ls -t "$ROOT"/logs/session_*.log 2>/dev/null | head -n 1 || true
}

cd "$ROOT"
command="${1:-help}"
[ $# -gt 0 ] && shift || true

case "$command" in
    build)
        exec "$PIO" run "$@"
        ;;
    upload)
        exec "$PIO" run -t upload "$@"
        ;;
    monitor)
        exec "$PIO" device monitor "$@"
        ;;
    capture)
        mkdir -p "$ROOT/logs"
        out="$ROOT/logs/session_$(date +%Y%m%d_%H%M%S).log"
        echo "[run] capturing serial output to $out  (Ctrl-C to stop)"
        "$PIO" device monitor "$@" 2>&1 | tee "$out"
        echo "[run] session saved: $out"
        echo "[run] analyze it with: ./scripts/run.sh analyze"
        ;;
    analyze)
        log="${1:-$(latest_log)}"
        if [ -z "$log" ]; then
            echo "[run] no capture found — run ./scripts/run.sh capture first" >&2
            exit 1
        fi
        shift 2>/dev/null || true
        exec "$PY" "$ROOT/scripts/analyze_logs.py" "$log" "$@"
        ;;
    cmd)
        [ $# -lt 1 ] && { echo "usage: run.sh cmd \"<console command>\"" >&2; exit 1; }
        # target the tester unless the caller pins a port with --port
        want_port=false
        for arg in "$@"; do [ "$arg" = "--port" ] && want_port=true; done
        if [ "$want_port" = false ]; then
            set -- "$@" --port "$("$PY" "$ROOT/scripts/find_ports.py" --kind m5stick)"
        fi
        exec "$PY" "$ROOT/scripts/serial_cmd.py" "$@"
        ;;
    test)
        exec "$PY" -m unittest discover -s "$ROOT/scripts/tests" -v
        ;;
    detect)
        echo "=== serial ports ==="
        "$PY" "$ROOT/scripts/serial_cmd.py" --list || true
        echo
        echo "=== flow device mapping ==="
        "$PY" "$ROOT/scripts/find_ports.py" --list || true
        ;;
    ports|flash-heltec|flash-tester|reboot|test-flow|flow)
        # two-device StoopNet loop — implemented in test_flow.sh
        case "$command" in
            test-flow) command="test" ;;
        esac
        exec "$ROOT/scripts/test_flow.sh" "$command" "$@"
        ;;
    envs)
        grep -E '^\[env:' "$ROOT/platformio.ini" | tr -d '[]'
        ;;
    clean)
        exec "$PIO" run -t clean
        ;;
    install)
        echo "[run] PlatformIO is ready: $PIO"
        ;;
    help|*)
        awk 'NR==1 {next} /^#/ {sub(/^#\s?/, ""); print; next} {exit}' "$ROOT/scripts/run.sh"
        echo
        echo "Environments: $(grep -E '^\[env:' "$ROOT/platformio.ini" | tr -d '[]' | sed 's/env://' | paste -sd' ')"
        ;;
esac
