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
#   ./scripts/run.sh envs       list the tester build environments
#   ./scripts/run.sh install    report where PlatformIO was found
#   ./scripts/run.sh clean      remove build artifacts
#
# Single-node flow (Heltec node + M5Stick client):
#   ./scripts/run.sh ports      show where each device is attached
#   ./scripts/run.sh flash-heltec / flash-tester   flash just one of them
#   ./scripts/run.sh reboot [heltec|tester|both]   reset one or both
#   ./scripts/run.sh test-flow  re-run the suite without reflashing
#   ./scripts/run.sh flow       flash both devices, reboot, run the WiFi suite
#
# Two-node mesh rig (Stoop-1/Stoop-2 nodes, M5Stick + ESP32-S3 kit clients):
#   ./scripts/run.sh flash-nodes    flash both StoopNet nodes (APs Stoop-1, Stoop-2)
#   ./scripts/run.sh flash-clients  flash both test clients (each joins its node)
#   ./scripts/run.sh mesh-flow      post via one node, verify arrival via the other
#
# Any build/upload/monitor command accepts extra PlatformIO arguments, e.g.
# `run.sh build -e s3-tester` to target the ESP32-S3 client instead of the stick.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/scripts"

# Prefer an already-installed pio; the private venv is the fallback. Host scripts
# need a python with pyserial — pio's own interpreter carries one.
# shellcheck source=scripts/pio_env.sh
source "$SCRIPTS/pio_env.sh"

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
    flash-nodes|flash-clients|mesh-flow)
        # two-node mesh rig — standalone scripts next to this one
        case "$command" in
            flash-nodes) script="flash_stoopnet.sh" ;;
            flash-clients) script="flash_stoopclient.sh" ;;
            mesh-flow) script="mesh_flow.sh" ;;
        esac
        exec "$ROOT/scripts/$script" "$@"
        ;;
    envs)
        list_envs "$ROOT/platformio.ini"
        ;;
    clean)
        exec "$PIO" run -t clean
        ;;
    install)
        # normally done implicitly by pio_env.sh on first use; exposed so you
        # can warm it up ahead of time and see where things landed
        source "$SCRIPTS/pio_env.sh" || exit 1
        echo "[run] PlatformIO is ready: $PIO"
        echo "[run] host python (pyserial): $PY"
        ;;
    help|*)
        # print this file's header comment block, minus the leading '# '
        awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0" | sed '/^$/d'
        echo
        echo "Environments: $(list_envs "$ROOT/platformio.ini")"
        ;;
esac
