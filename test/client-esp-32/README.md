# StoopNet ESP32 test devices

Small ESP32 boards that act as automated test clients for StoopNet nodes (the
Heltec WiFi LoRa 32 running `heltec_v4_*_stoop_radio` in the parent repo).
A client joins a node's WiFi access point, exercises the captive portal and
web API over HTTP, and reports pass/fail so firmware changes can be verified
end-to-end with one command. With two nodes and two clients attached at once,
`mesh_flow.sh` also proves a post crosses from one node to the other over the
LoRa mesh.

## The rig

| device | runs | role |
|---|---|---|
| Heltec WiFi LoRa 32 (S3) #1 | StoopNet firmware (parent repo) | node 1: open AP **Stoop-1** on `8.8.8.8` with a captive portal |
| Heltec WiFi LoRa 32 (S3) #2 | StoopNet firmware (parent repo) | node 2: open AP **Stoop-2**, same channel as node 1 |
| LilyGo T-Deck | StoopNet firmware, `t_deck_stoop_radio` env | node 3: open AP **Stoop-3**; its color LCD shows a scan-to-join QR (`WIFI:T:nopass;S:Stoop-3;;`) as the default screen |
| M5StickC / M5StickC Plus | this repo's `m5stick-tester` firmware | test client, joins **Stoop-1** |
| ESP32-S3 dev kit ("standard ESP32") | this repo's `s3-tester` firmware | test client, joins **Stoop-2** (a classic WROOM kit uses `esp32-tester` instead) |

`flash_stoopnet.sh` names the APs (and mesh node names) `Stoop-1`, `Stoop-2`,
... by passing `-D WIFI_SSID` / `-D STOOP_NODE_NAME` per build, so posts
attributed on the mesh read `user@stoop-1` / `user@stoop-2`. It takes node
numbers: `flash_stoopnet.sh 3` flashes only node 3. All nodes must be flashed
from the same checkout so their `#stoop` channel key and LoRa band match —
otherwise they can't hear each other.

The T-Deck's QR screen is the one place with a length budget. The QR is pinned
to version 2, which carries at most **32 bytes** of payload, and
`WIFI:T:nopass;S:<ssid>;;` spends 18 of them on the wrapper. So the SSID has to
fit in 14 characters: `Stoop-3` is fine (25 bytes total), but the stock
`Neighborhood Board (free)` is 43 bytes and the screen shows `ssid too long for
qr` instead of a code. Any rig that wants the QR should flash short
`Stoop-N` SSIDs, which is what `flash_stoopnet.sh` does anyway.

Ports: the T-Deck and the ESP32-S3 kit both enumerate as ESP32 native-USB
devices (VID 303a), so when both are attached the scripts refuse to guess —
pin the test client with `CLIENT2_PORT` (find_ports.py --list maps them).

## The flows

```bash
./scripts/run.sh flash-nodes     # build + flash both nodes (APs Stoop-1, Stoop-2)
./scripts/run.sh flash-clients   # build + flash both test clients
./scripts/run.sh mesh-flow       # the two-node relay test (see below)
./scripts/run.sh ports           # show which port each device was found on
```

`flash_stoopnet.sh [count]` and `flash_stoopclient.sh [all|m5stick|s3]` find
each board by USB identity and pin it with `NODE<i>_PORT` / `CLIENT<i>_PORT`
(or `STOOP_HELTEC<i>_PORT` / `STOOP_M5_PORT` / `STOOP_ESP32_PORT`); a rig with
several boards of the same kind needs ports pinned explicitly, since identical
bridges look alike. The scripts only start flashing after both arguments and
both ports have resolved, so a typo fails immediately instead of half-way
through a rig.

Every script resolves PlatformIO and a pyserial-capable Python the same way
(`scripts/pio_env.sh`): `$DR_PIO_BIN`, then `pio` on `$PATH`, then a private
venv at `~/.local/share/venvs/platformio` which is installed on demand. Set
`STOOP_PIO_NOINSTALL=1` to make a missing PlatformIO a hard error instead —
handy in CI. `run.sh install` reports where both landed.

`mesh_flow.sh` (in `scripts/mesh_flow.sh`) runs the mesh relay test:

1. Reboots both nodes and waits for their APs (`--skip-reboot` to assume up).
2. Reboots both clients under serial capture; each runs its HTTP suite
   against *its own* node first, which validates both WiFi hops.
3. Client 1 posts a unique marker through Stoop-1's `/api/post`; client 2
   polls Stoop-2's `/api/stoop/messages` until the marker arrives over LoRa
   (`MESH_WAIT_SECS`, default 90 s).
4. Repeats in the other direction (`--one-way` to run only A→B).

Exit code 0 only when every direction passed.

The older single-node loop still works (`./scripts/run.sh flow`): it flashes
one Heltec + the stick and runs the stick's suite against it.

## What the client suite covers

The tester prints `SELFTEST|name=…|result=…` lines (plus a
`SELFTEST|suite=stoop_tester|…` summary) that `analyze_logs.py` understands:

| test | check |
|---|---|
| `ap_connect` | the node's AP is visible and accepts the association |
| `got_ip` | DHCP hands out an address in the node's 8.8.8.x subnet |
| `http_index` | `GET /` serves the gzipped portal page (sniffs gzip magic) |
| `http_portal_probe` | Android's `/generate_204` probe gets the portal (200) |
| `http_unknown_redirects` | unknown paths 302-redirect to the portal root |
| `http_max_message_bytes` | `/api/stoop/max_message_bytes` returns a number |
| `http_messages_json` | `/api/stoop/messages` returns a JSON array |
| `http_limits` | `/api/limits` reports rate-limit tokens as JSON |
| `post_and_readback` | end-to-end: `POST /api/post` a marker message, then find that exact marker in `/api/stoop/messages` |

Two serial-console one-shots back the mesh test (`run | post <text> |
wait <secs> <text> | status | reboot | help`):

| command | what it does |
|---|---|
| `post <text>` | posts `<text>` through this client's node (`SELFTEST\|name=post`) |
| `wait <secs> <text>` | polls the board until `<text>` shows up (`SELFTEST\|name=mesh_recv`) |

Every suite run posts one real message to the #stoop channel. The user
bucket starts with 5 tokens and refills one per 30 s, so if `mesh_flow.sh`
runs back-to-back you may see a `429` — give it a minute.

LED: hunts while joining, blips per test, holds solid on PASS, fast-blinks on
FAIL. The S3 dev-kit env has no plain LED, so it stays dark.

## Iterating

- Node firmware changed? Edit `examples/stoop_net_radio/` in the parent repo,
  then `./scripts/run.sh flash-nodes && ./scripts/run.sh mesh-flow`.
- Only the test client changed? Edit `src/tester/tester_main.cpp`, then
  `./scripts/run.sh flash-clients && ./scripts/run.sh mesh-flow`.

Manual debugging: `./scripts/run.sh monitor` (stick) or `capture` + `analyze`
for saved sessions — captures from the flows land in `logs/` too.

## Testing

Two distinct kinds of test live here, and only the first one runs in CI.

### Host-side unit tests — `./scripts/run.sh test`

No hardware, no PlatformIO, no device. 63 tests, ~0.1 s, run with the stdlib
`unittest` runner against the scripts in this directory:

| spec | covers |
|---|---|
| `test_flow_helpers.py` | the `SELFTEST` verdict parser (pass / one failure / no summary / empty capture) and USB-identity → device-kind classification, including the port ordering that `--index` relies on |
| `test_analyze_logs.py` | the serial-log analyzer: esp_log line shapes, all five levels, ANSI stripping, host-timestamp prefixes, restart and stall detection, heap-trend leak detection, and the `--json` output |
| `test_serial_cmd.py` | the console CLI: legacy-`ttyS` filtering, vidless ACM ports, vendor-preference port selection, `--wait`/`--quiet` parsing |
| `test_platformio_config.py` | `platformio.ini` invariants — see below |
The `platformio.ini` tests are the interesting ones, because they catch a
whole class of rig failure *before* anything is flashed: the client's join
parameters (`STOOP_TEST_SSID`, `STOOP_TEST_HOST`) must match the node
firmware's softAP config, or every suite run fails with "no AP" and you go
looking for a hardware fault that isn't there. They also pin the LED GPIO
per board, assert `CDC_ON_BOOT` stays on for the S3 kit (without it the logs
never reach the host at all), and check the exception decoder is in
`monitor_filters` so panic backtraces survive into captures.

These run in the `test-rig-host-tests` CI job on every push and PR.

### On-device tests — everything else

`flow`, `test-flow` and `mesh-flow` need the physical rig and are not run in
CI. They flash, reboot, and read verdicts off the serial console; the exit
code is 0 only when every direction passed, so they *could* be gated on a
self-hosted runner with the hardware attached, but nothing does that yet.

To iterate quickly without a rig, the firmware builds standalone:

```bash
./scripts/run.sh build -e m5stick-tester   # or s3-tester / esp32-tester
./scripts/run.sh envs                      # list the three
```

All three envs pin `espressif32@6.11.0`, the same version the parent repo uses
for its ESP32 targets, and that pin matters: with a bare
`platform = espressif32` the resolver floats to the newest release, whose
arduino-esp32 no longer ships the `m5stick_c` variant that `board = m5stick-c`
names, and the build fails with `fatal error: pins_arduino.h: No such file or
directory` before it ever reaches the tester source.
`test_platformio_config.py` asserts the pin so this cannot regress silently.

## Known gaps

- No CI covers the on-device suites, and no test asserts the T-Deck
  `t_deck_stoop_radio` env or the QR screen renders.
- `analyze_logs.py` parses esp_log's `I (ms) tag:` prefix. The tester logs as
  `[ms] stoop-tester: ...`, so its captures yield the selftest section only.
  Use `summarize_tests.py` for the tester; `analyze_logs.py` is really for node
  firmware.
- `serial_cmd.py` without `--port` picks a board by USB vendor, and a node's
  CP210x ranks equal to a tester's. On the full rig always pass `--port`
  (`run.sh cmd` does).

## Prerequisites

- PlatformIO — auto-installed on first `run.sh` call into
  `~/.local/share/venvs/platformio` if not already on `$PATH`.
- A Python with `pyserial`. The scripts prefer PlatformIO's own interpreter
  (it has one) and fall back to `$DR_PIO_PYTHON`, then `python3`. A bare
  `python3` without pyserial is the usual reason the unit tests fail with
  `No module named 'serial'` — run them through `./scripts/run.sh test` rather
  than calling `unittest` yourself.
- Devices attached over USB (data cables, not charge-only). The M5Stick and
  the ESP32-S3 kit expose different USB identities, so both stay
  auto-detectable; two identical Heltecs are told apart by port order
  (`find_ports.py --list`) — pin with `NODE1_PORT`/`NODE2_PORT` if in doubt.
- On Linux you may need the `dialout` group for serial access; `run.sh detect`
  prints what to check.
