#!/usr/bin/env bash
# mesh_flow.sh — prove a message crosses between the two StoopNet nodes over
# the LoRa mesh, using the rig's two test clients as the endpoints:
#
#   client 1 (joins Stoop-1) --POST /api/post--> node 1 ~~~LoRa~~~ node 2
#   client 2 (joins Stoop-2) <--GET /api/stoop/messages-- node 2
#
#   mesh_flow.sh                 full run: A->B, then B->A
#   mesh_flow.sh --one-way       only A->B
#   mesh_flow.sh --skip-reboot   assume both nodes are already up
#   mesh_flow.sh --skip-boot     skip the per-client boot suite check
#
# Ports: NODE1_PORT / NODE2_PORT / CLIENT1_PORT / CLIENT2_PORT, or
# auto-detected (find_ports.py --list shows the mapping).
#
# Knobs: AP_WAIT_SECS (default 15)   node AP startup after a reboot
#        CAPTURE_TIMEOUT (default 150) boot-suite capture limit
#        MESH_WAIT_SECS (default 90)   how long the receiver polls for the marker
#
# Exit code 0 only when every direction passes, so CI can gate on it.
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPTS")"                 # client-esp-32/
MAIN_REPO="$(cd "$ROOT/../.." && pwd)"       # the StoopNet (MeshCore fork) repo

AP_WAIT_SECS="${AP_WAIT_SECS:-15}"
CAPTURE_TIMEOUT="${CAPTURE_TIMEOUT:-150}"
MESH_WAIT_SECS="${MESH_WAIT_SECS:-90}"

ONE_WAY=0; REBOOT_NODES=1; BOOT_CHECK=1
for arg in "$@"; do
    case "$arg" in
        --one-way) ONE_WAY=1 ;;
        --skip-reboot) REBOOT_NODES=0 ;;
        --skip-boot) BOOT_CHECK=0 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

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

port_of() { "$PY" "$SCRIPTS/find_ports.py" "$@"; }
reboot_port() { "$PY" "$SCRIPTS/reboot_device.py" --port "$1"; }
# send a console command and save the device's reply; prints the output
send_cmd() { # port wait_secs quiet_secs cmd...
    local port="$1" wait="$2" quiet="$3"; shift 3
    "$PY" "$SCRIPTS/serial_cmd.py" --port "$port" --wait "$wait" --quiet "$quiet" "$@"
}

NODE1="${NODE1_PORT:-$(port_of --kind heltec --index 0)}" || exit 1
NODE2="${NODE2_PORT:-$(port_of --kind heltec --index 1)}" || exit 1
CLIENT1="${CLIENT1_PORT:-$(port_of --kind m5stick)}" || exit 1
# several esp32-class boards attached (e.g. the S3 kit AND a T-Deck node, both
# VID 303a)? pin the test client explicitly rather than letting index 0 win
if [ -z "${CLIENT2_PORT:-}" ]; then
    count="$(port_of --kind esp32 --count)" || exit 1
    if [ "$count" -gt 1 ]; then
        echo "ERROR: $count esp32-class boards attached; set CLIENT2_PORT (see: find_ports.py --list)" >&2
        exit 1
    fi
fi
CLIENT2="${CLIENT2_PORT:-$(port_of --kind esp32)}" || exit 1
echo "[mesh] node1: $NODE1   node2: $NODE2"
echo "[mesh] client1 (Stoop-1): $CLIENT1   client2 (Stoop-2): $CLIENT2"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- 1. fresh nodes --------------------------------------------------------
if [ "$REBOOT_NODES" = 1 ]; then
    echo "[mesh] rebooting both nodes, waiting ${AP_WAIT_SECS}s for the APs ..."
    reboot_port "$NODE1" & reboot_port "$NODE2" & wait
    sleep "$AP_WAIT_SECS"
fi

# --- 2. reboot the clients under capture; each runs its suite against its
#        own node, which validates both hops before the mesh test starts
mkdir -p "$ROOT/logs"
TS="$(date +%Y%m%d_%H%M%S)"
if [ "$BOOT_CHECK" = 1 ]; then
    echo "[mesh] rebooting clients; capturing their boot suites ..."
    ( "$PY" "$SCRIPTS/capture_until.py" --port "$CLIENT1" --reset \
          --stop 'SELFTEST\|suite=' --timeout "$CAPTURE_TIMEOUT" \
          --out "$ROOT/logs/meshflow_c1_$TS.log" >/dev/null 2>&1 ) &
    ( "$PY" "$SCRIPTS/capture_until.py" --port "$CLIENT2" --reset \
          --stop 'SELFTEST\|suite=' --timeout "$CAPTURE_TIMEOUT" \
          --out "$ROOT/logs/meshflow_c2_$TS.log" >/dev/null 2>&1 ) &
    wait
    echo "[mesh] client 1 boot suite (its own node, Stoop-1):"
    "$PY" "$SCRIPTS/summarize_tests.py" "$ROOT/logs/meshflow_c1_$TS.log" || {
        echo "[mesh] client 1 cannot reach Stoop-1 — is node 1 up and flashed with AP Stoop-1?" >&2; exit 1; }
    echo "[mesh] client 2 boot suite (its own node, Stoop-2):"
    "$PY" "$SCRIPTS/summarize_tests.py" "$ROOT/logs/meshflow_c2_$TS.log" || {
        echo "[mesh] client 2 cannot reach Stoop-2 — is node 2 up and flashed with AP Stoop-2?" >&2; exit 1; }
fi

# --- 3. the relay ----------------------------------------------------------
# send <from_client> <to_client> <tag>: post a unique marker through the
# sender's node, then poll the receiver's node until it arrives over LoRa.
relay() {
    local from="$1" to="$2" tag="$3"
    local marker="mesh-e2e-$tag-$(date +%s)"
    echo "[mesh] $tag: posting \"$marker\" via client on $( [ "$tag" = A2B ] && echo Stoop-1 || echo Stoop-2 ) ..."

    if ! send_cmd "$from" 30 1 post "$marker" > "$TMP/post_$tag.txt"; then
        echo "[mesh] $tag: sender not responding on $from" >&2; return 1
    fi
    if ! grep -qF "SELFTEST|name=post|result=PASS" "$TMP/post_$tag.txt"; then
        echo "[mesh] $tag: POST failed:" >&2; grep -F "SELFTEST|name=post" "$TMP/post_$tag.txt" >&2 || cat "$TMP/post_$tag.txt" >&2
        return 1
    fi

    # the wait command polls every ~2s and prints progress lines, so hold the
    # port open past the poll window (--quiet > 2s)
    if ! send_cmd "$to" $((MESH_WAIT_SECS + 40)) 5 wait "$MESH_WAIT_SECS" "$marker" \
            > "$TMP/wait_$tag.txt"; then
        echo "[mesh] $tag: receiver not responding on $to" >&2; return 1
    fi
    if ! grep -qF "SELFTEST|name=mesh_recv|result=PASS" "$TMP/wait_$tag.txt"; then
        echo "[mesh] $tag: marker never arrived via the mesh:" >&2
        grep -F "SELFTEST|name=mesh_recv" "$TMP/wait_$tag.txt" | tail -3 >&2
        grep "not yet" "$TMP/wait_$tag.txt" | tail -3 >&2
        return 1
    fi
    grep "SELFTEST|name=mesh_recv" "$TMP/wait_$tag.txt"
    echo "[mesh] $tag: PASS — message crossed the mesh"
}

RESULT=0
relay "$CLIENT1" "$CLIENT2" A2B || RESULT=1
if [ "$ONE_WAY" = 0 ]; then
    relay "$CLIENT2" "$CLIENT1" B2A || RESULT=1
fi

if [ "$RESULT" = 0 ]; then
    echo "[mesh] MESH FLOW: PASS"
else
    echo "[mesh] MESH FLOW: FAIL" >&2
fi
exit "$RESULT"
