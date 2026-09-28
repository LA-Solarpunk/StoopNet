#!/usr/bin/env bash
# flash_stoopclient.sh — flash the rig's test clients with the stoop-tester
# firmware; client N is built to join node N's access point (Stoop-1, Stoop-2).
#
#   flash_stoopclient.sh             flash both: M5Stick -> Stoop-1, S3 kit -> Stoop-2
#   flash_stoopclient.sh m5stick     just the M5StickC
#   flash_stoopclient.sh s3          just the ESP32-S3 dev kit
#   CLIENT1_PORT / CLIENT2_PORT      pin ports (STOOP_M5_PORT / STOOP_ESP32_PORT
#                                    are honored too; `run.sh ports` maps them)
#   CLIENT1_SSID / CLIENT2_SSID      override which Stoop AP a client joins
#   CLIENT2_ENV=esp32-tester         the client is a classic WROOM kit, not S3
#   TESTER_LABEL=<label>             boot-banner tag (default: git hash + time)
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPTS")"                 # client-esp-32/
MAIN_REPO="$(cd "$ROOT/../.." && pwd)"       # the StoopNet (MeshCore fork) repo

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

LABEL="${TESTER_LABEL:-$(git -C "$MAIN_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)-$(date +%m%d-%H%M)}"
WHICH="${1:-all}"

declare -a FLASHED=()
FAILED=0

flash_client() {
    local n="$1" kind="$2" env="$3" port="$4" ssid="$5"
    if [ -z "$port" ]; then
        # refuse to guess when several boards of this kind are attached (e.g.
        # an ESP32-S3 test client AND a T-Deck node both look like VID 303a)
        count=$("$PY" "$SCRIPTS/find_ports.py" --kind "$kind" --count) || { FAILED=1; return; }
        if [ "$count" -gt 1 ]; then
            echo "[client$n] ERROR: $count $kind boards attached — set CLIENT${n}_PORT (see: run.sh ports)" >&2
            FAILED=1; return
        fi
        port="$("$PY" "$SCRIPTS/find_ports.py" --kind "$kind")" || { FAILED=1; return; }
    fi
    echo "[client$n] flashing $env -> $port  (joins AP \"$ssid\")"
    (cd "$ROOT" && PLATFORMIO_BUILD_FLAGS="-D STOOP_TEST_SSID='\"$ssid\"' -D TESTER_BUILD_LABEL='\"$LABEL\"'" \
        "$PIO" run -e "$env" -t upload --upload-port "$port") || { echo "[client$n] FLASH FAILED" >&2; FAILED=1; return; }
    FLASHED+=("client$n  $port  joins \"$ssid\"  ($env, label $LABEL)")
}

case "$WHICH" in
    all|m5stick)
        flash_client 1 m5stick "${CLIENT1_ENV:-m5stick-tester}" \
            "${CLIENT1_PORT:-${STOOP_M5_PORT:-}}" "${CLIENT1_SSID:-Stoop-1}"
        ;;
esac
case "$WHICH" in
    all|s3)
        flash_client 2 esp32 "${CLIENT2_ENV:-s3-tester}" \
            "${CLIENT2_PORT:-${STOOP_ESP32_PORT:-}}" "${CLIENT2_SSID:-Stoop-2}"
        ;;
esac
case "$WHICH" in
    all|m5stick|s3) ;;
    *) echo "usage: flash_stoopclient.sh [all|m5stick|s3] (got: $WHICH)" >&2; exit 2 ;;
esac

echo
if [ ${#FLASHED[@]} -gt 0 ]; then
    echo "flashed:"
    for line in "${FLASHED[@]}"; do echo "  $line"; done
fi
if [ "$FAILED" = 1 ]; then
    echo "one or more client flashes failed — see output above" >&2
    exit 1
fi
