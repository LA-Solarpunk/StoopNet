#!/usr/bin/env bash
# StoopNet two-device test flow: Heltec node <-> M5StickC test client.
#
#   test_flow.sh ports          show which port each device was found on
#   test_flow.sh flash-heltec   build + flash the StoopNet node
#   test_flow.sh flash-tester   build + flash the M5Stick test client
#   test_flow.sh reboot [what]  reboot heltec|tester|both (default both)
#   test_flow.sh test           reboot both, capture the stick's suite, verdict
#   test_flow.sh flow           flash both, then test   (the whole loop)
#
# Flags for `flow`/`test`:
#   STOOP_FLASH_HELTEC=0 flow   skip the node flash (re-use what's on it)
#   STOOP_FLASH_TESTER=0 flow   skip the stick flash
#   HELTEC_ENV=<env>            node build env (default heltec_v4_r8_stoop_radio)
#   AP_WAIT_SECS=<n>            seconds to let the node's AP come up (default 12)
#   CAPTURE_TIMEOUT=<n>         seconds to wait for the suite (default 150)
#   STOOP_HELTEC_PORT / STOOP_M5_PORT   pin a port, skip auto-detection
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPTS")"                 # client-esp-32/
MAIN_REPO="$(cd "$ROOT/.." && pwd)"          # the StoopNet (MeshCore fork) repo

HELTEC_ENV="${HELTEC_ENV:-heltec_v4_r8_stoop_radio}"
AP_WAIT_SECS="${AP_WAIT_SECS:-12}"
CAPTURE_TIMEOUT="${CAPTURE_TIMEOUT:-150}"

# --- resolve PlatformIO + a python that has pyserial (same policy as run.sh)
if [ -n "${DR_PIO_BIN:-}" ]; then
    PIO="$DR_PIO_BIN"
elif command -v pio >/dev/null 2>&1; then
    PIO="$(command -v pio)"
else
    VENV="$HOME/.local/share/venvs/platformio"
    [ -x "$VENV/bin/pio" ] || { echo "no pio found — run ./scripts/run.sh once to install" >&2; exit 1; }
    PIO="$VENV/bin/pio"
fi
PIO_PY="$(head -1 "$PIO" | sed 's/^#!//')"
if [ -x "$PIO_PY" ] && "$PIO_PY" -c 'import serial' 2>/dev/null; then
    PY="$PIO_PY"
else
    PY="${DR_PIO_PYTHON:-python3}"
fi

port_of() {
    "$PY" "$SCRIPTS/find_ports.py" --kind "$1" || return 1
}

do_flash_heltec() {
    echo "[flow] building + flashing node ($HELTEC_ENV) ..."
    (cd "$MAIN_REPO" && "$PIO" run -e "$HELTEC_ENV" -t upload --upload-port "$1") || return 1
}

do_flash_tester() {
    # tag this build so boot banner + posted marker prove which bits ran
    local label="${TESTER_LABEL:-$(git -C "$MAIN_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)-$(date +%m%d-%H%M)}"
    echo "[flow] building + flashing tester (label: $label) ..."
    (cd "$ROOT" && PLATFORMIO_BUILD_FLAGS="-D TESTER_BUILD_LABEL='\"$label\"'" \
        "$PIO" run -e m5stick-tester -t upload --upload-port "$1") || return 1
}

do_reboot() {
    case "$1" in
        heltec) "$PY" "$SCRIPTS/reboot_device.py" --port "$2" ;;
        tester) "$PY" "$SCRIPTS/reboot_device.py" --port "$2" ;;
        both)
            "$PY" "$SCRIPTS/reboot_device.py" --port "$2" || echo "[flow] WARN: node reboot failed" >&2
            "$PY" "$SCRIPTS/reboot_device.py" --port "$3" || echo "[flow] WARN: tester reboot failed" >&2
            ;;
    esac
}

do_test() {
    local heltec="$1" tester="$2"

    echo "[flow] rebooting node, waiting ${AP_WAIT_SECS}s for its AP ..."
    "$PY" "$SCRIPTS/reboot_device.py" --port "$heltec" \
        || echo "[flow] WARN: could not reset node (it may still be up from an earlier run)" >&2
    sleep "$AP_WAIT_SECS"

    mkdir -p "$ROOT/logs"
    local log="$ROOT/logs/session_flow_$(date +%Y%m%d_%H%M%S).log"
    echo "[flow] resetting tester and listening on $tester ..."
    if ! "$PY" "$SCRIPTS/capture_until.py" --port "$tester" --reset \
            --stop 'SELFTEST\|suite=' --timeout "$CAPTURE_TIMEOUT" --out "$log"; then
        echo "[flow] capture failed or timed out after ${CAPTURE_TIMEOUT}s" >&2
    fi
    echo "[flow] capture saved: $log"

    "$PY" "$SCRIPTS/summarize_tests.py" "$log"
}

cmd="${1:-help}"
[ $# -gt 0 ] && shift

case "$cmd" in
    ports)
        "$PY" "$SCRIPTS/find_ports.py" --list
        ;;
    flash-heltec)
        do_flash_heltec "$(port_of heltec)"
        ;;
    flash-tester)
        do_flash_tester "$(port_of m5stick)"
        ;;
    reboot)
        what="${1:-both}"; [ $# -gt 0 ] && shift
        case "$what" in
            heltec)  do_reboot heltec "$(port_of heltec)" ;;
            tester)  do_reboot tester "$(port_of m5stick)" ;;
            both)    do_reboot both "$(port_of heltec)" "$(port_of m5stick)" ;;
            *) echo "reboot what? heltec | tester | both" >&2; exit 2 ;;
        esac
        ;;
    test)
        do_test "$(port_of heltec)" "$(port_of m5stick)"
        ;;
    flow)
        flash_heltec="${STOOP_FLASH_HELTEC:-1}"
        flash_tester="${STOOP_FLASH_TESTER:-1}"
        heltec="$(port_of heltec)"; tester="$(port_of m5stick)" || exit 1
        echo "[flow] node: $heltec   tester: $tester"
        [ "$flash_heltec" = 1 ] && do_flash_heltec "$heltec"
        [ "$flash_tester" = 1 ] && do_flash_tester "$tester"
        do_test "$heltec" "$tester"
        ;;
    help|*)
        awk 'NR==1 {next} /^#/ {sub(/^#\s?/, ""); print; next} {exit}' "$SCRIPTS/test_flow.sh"
        ;;
esac
