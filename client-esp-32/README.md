# StoopNet ESP32 test device

An M5StickC / M5StickC Plus that acts as an automated test client for a
StoopNet node (the Heltec WiFi LoRa 32 running `heltec_v4_*_stoop_radio` in
the parent repo). The stick joins the node's WiFi access point, exercises the
captive portal and web API over HTTP, and reports pass/fail so firmware
changes can be verified end-to-end with one command.

## The rig

| device | runs | role |
|---|---|---|
| Heltec WiFi LoRa 32 (S3) | StoopNet firmware (parent repo) | the system under test: open AP *Neighborhood Board (free)* on `8.8.8.8` with a captive portal |
| M5StickC / M5StickC Plus | this repo's `m5stick-tester` firmware | test client: joins that AP and runs an HTTP suite against the node |

## The flow

```bash
./scripts/run.sh flow        # build + flash both devices, reboot, run the suite
./scripts/run.sh test-flow   # re-run the suite without reflashing
```

`flow` (implemented in `scripts/test_flow.sh`):

1. Finds each device by USB identity — `./scripts/run.sh ports` shows the
   mapping; pin one down with `STOOP_HELTEC_PORT` / `STOOP_M5_PORT`.
2. Flashes the node from the parent repo (`HELTEC_ENV`, default
   `heltec_v4_r8_stoop_radio`) and the stick from this repo.
3. Reboots both, waits for the node's AP, then resets the stick under serial
   capture and listens until its suite finishes.

Each build is tagged with a label (parent-repo commit + time) that appears in
the stick's boot banner and inside the posted test message, so a PASS always
proves the bits you just built are the bits being exercised. The exit code is
0 only when the suite passes, so this gates CI or a loop directly.

Useful knobs:

| variable | meaning |
|---|---|
| `STOOP_FLASH_HELTEC=0` | skip the node flash (only the stick changed) |
| `STOOP_FLASH_TESTER=0` | skip the stick flash (only the node changed) |
| `HELTEC_ENV` | node build env in the parent repo |
| `AP_WAIT_SECS` / `CAPTURE_TIMEOUT` | flow timing |

## What the suite covers

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
| `post_and_readback` | end-to-end: `POST /api/post` a marker message, then find that exact marker in `/api/stoop/messages` — the web API through the rate limiter and the mesh send path |

Every suite run posts one real message to the #stoop channel
(`stoop-tester@stoop`). The user bucket starts with 5 tokens and refills one
per 30 s, which is plenty for bench testing.

The stick also takes serial console commands at 115200 (`run`, `status`,
`reboot`, `help`); `./scripts/run.sh cmd run` re-runs the suite without
touching power. LED: hunts while joining, blips per test, holds solid on
PASS, fast-blinks on FAIL.

## Iterating

- Node firmware changed? Edit `examples/stoop_net_radio/` in the parent repo,
  then `./scripts/run.sh flow`.
- Only the test client changed? Edit `src/tester/tester_main.cpp`, then
  `STOOP_FLASH_HELTEC=0 ./scripts/run.sh flow`.

Manual debugging: `./scripts/run.sh monitor` (stick) or `capture` + `analyze`
for saved sessions — captures from the flow land in `logs/` too.

## Testing

```bash
./scripts/run.sh test
```

Host-side unittest suite (`scripts/tests/`, no device needed): the verdict
parser, flow port classification, the serial CLI, the log analyzer, and the
`platformio.ini` invariants (join parameters must match the node firmware's
softAP config — a mismatch fails the suite before anything gets flashed).

## Prerequisites

- PlatformIO — auto-installed on first `run.sh` call into
  `~/.local/share/venvs/platformio` if not already on `$PATH`.
- Both devices attached over USB (data cables, not charge-only).
- On Linux you may need the `dialout` group for serial access; `run.sh detect`
  prints what to check.
