#!/usr/bin/env bash
# flash_stoopnet.sh — flash StoopNet onto the rig's LoRa node(s), naming each
# access point Stoop-<n> (and the mesh node name stoop-<n>, so posts carry
# "user@stoop-n" and the mesh test can attribute them).
#
#   flash_stoopnet.sh              flash nodes 1 and 2
#   flash_stoopnet.sh 3            flash only node 3
#   flash_stoopnet.sh 1 3          flash nodes 1 and 3
#   NODE2_PORT=/dev/cu.usbserial-X flash_stoopnet.sh      pin a port per node
#   NODE2_ENV=heltec_v4_stoop_radio flash_stoopnet.sh     per-node build env
#   HELTEC_ENV=<env>               build env for every node
#                                  (default heltec_v4_r8_stoop_radio)
#
# Ports not pinned via NODE<i>_PORT are auto-detected with find_ports.py
# (--kind heltec --index <i-1>); `./scripts/run.sh ports` shows the mapping.
#
# All nodes must be flashed from the same checkout: the #stoop channel key
# (platformio.local.ini [stoop_secrets]) and the LoRa band flags have to match
# or the nodes will not hear each other.
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPTS")"                 # client-esp-32/
MAIN_REPO="$(cd "$ROOT/../.." && pwd)"       # the StoopNet (MeshCore fork) repo

HELTEC_ENV="${HELTEC_ENV:-heltec_v4_r8_stoop_radio}"

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

if [ $# -gt 0 ]; then
    NODES="$@"
else
    NODES="1 2"
fi

declare -a FLASHED=()
FAILED=0

for i in $NODES; do
    case "$i" in ''|*[!0-9]*) echo "usage: flash_stoopnet.sh [node numbers] (got: $i)" >&2; exit 2;; esac
    port_var="NODE${i}_PORT"
    port="${!port_var:-}"
    if [ -z "$port" ]; then
        port="$("$PY" "$SCRIPTS/find_ports.py" --kind heltec --index $((i - 1)))" || { FAILED=1; continue; }
    fi
    env_var="NODE${i}_ENV"
    env="${!env_var:-$HELTEC_ENV}"

    echo "[node$i] flashing $env -> $port  (AP: Stoop-$i)"
    (cd "$MAIN_REPO" && PLATFORMIO_BUILD_FLAGS="-D WIFI_SSID='\"Stoop-$i\"' -D STOOP_NODE_NAME='\"stoop-$i\"'" \
        "$PIO" run -e "$env" -t upload --upload-port "$port") || { echo "[node$i] FLASH FAILED" >&2; FAILED=1; continue; }
    FLASHED+=("node$i  $port  AP \"Stoop-$i\"  ($env)")
done

echo
if [ ${#FLASHED[@]} -gt 0 ]; then
    echo "flashed:"
    for line in "${FLASHED[@]}"; do echo "  $line"; done
fi
if [ "$FAILED" = 1 ]; then
    echo "one or more node flashes failed — see output above" >&2
    exit 1
fi
