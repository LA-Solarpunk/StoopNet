#!/usr/bin/env bash
# pio_env.sh — locate (or install) PlatformIO and a Python that has pyserial.
#
# Sourced by every other script in this directory. Sets $VENV, $PIO and $PY and
# returns non-zero if PlatformIO could not be found or installed. There is
# deliberately no `exit` here, so each caller decides how to report the failure.
#
# Resolution order for PlatformIO:
#   $PIO          — already set by the caller
#   $DR_PIO_BIN   — explicit override
#   pio on $PATH  — the usual case
#   $VENV         — ~/.local/share/venvs/platformio, installed on demand
#
# The interpreter is resolved separately: PlatformIO's own venv carries
# pyserial, so we prefer that, falling back to $DR_PIO_PYTHON or a bare python3.

VENV="${DR_PIO_VENV:-$HOME/.local/share/venvs/platformio}"

# One-liner reused by run.sh: list a platformio.ini's [env:...] names on one
# line. Uses tr rather than `paste -sd' '`, which BSD paste will not accept as
# a stdin filter.
list_envs() {
    grep -E '^\[env:' "$1" | tr -d '[]' | sed 's/env://' | tr '\n' ' '
}

install_pio() {
    echo "[pio] PlatformIO not found — installing into $VENV ..."
    python3 -m venv "$VENV" || return 1
    "$VENV/bin/pip" install -q -U platformio || return 1
    echo "[pio] done."
}

if [ -n "${PIO:-}" ]; then
    :
elif [ -n "${DR_PIO_BIN:-}" ]; then
    PIO="$DR_PIO_BIN"
elif command -v pio >/dev/null 2>&1; then
    PIO="$(command -v pio)"
elif [ -x "$VENV/bin/pio" ]; then
    PIO="$VENV/bin/pio"
elif [ "${STOOP_PIO_NOINSTALL:-0}" = "1" ]; then
    echo "no PlatformIO found (and STOOP_PIO_NOINSTALL=1) — set DR_PIO_BIN or add pio to \$PATH" >&2
    return 1
else
    install_pio || return 1
    PIO="$VENV/bin/pio"
fi

# the shebang line tells us which interpreter pio itself runs under, and that is
# the one guaranteed to have pyserial
PIO_PY="$(head -1 "$PIO" | sed 's/^#!//')"
if [ -x "$PIO_PY" ] && "$PIO_PY" -c 'import serial' >/dev/null 2>&1; then
    PY="$PIO_PY"
else
    PY="${DR_PIO_PYTHON:-python3}"
fi
