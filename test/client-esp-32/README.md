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
bridges look alike.

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
- Devices attached over USB (data cables, not charge-only). The M5Stick and
  the ESP32-S3 kit expose different USB identities, so both stay
  auto-detectable; two identical Heltecs are told apart by port order
  (`find_ports.py --list`) — pin with `NODE1_PORT`/`NODE2_PORT` if in doubt.
- On Linux you may need the `dialout` group for serial access; `run.sh detect`
  prints what to check.
