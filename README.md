# StoopNet

Stoop Net is a solar-powered LoRa mesh node that runs a local bulletin board over WiFi. One node serves everyone nearby with a phone or computer. Built on [MeshCore](https://github.com/meshcore-dev/MeshCore) as the mesh transport.

After the fires in LA and with the potential for bad floods with the changing climate, it seemed like a good idea to have a system for distributed communication that will still function if the main infrasture goes down. This project is partly inspired by projects like disaster.radio, but attempts to make it even more accessible without the need to install an app and running on very low cost hardware.

## The idea

Existing LoRa bulletin boards (MeshCore room servers, Meshtastic BBS) require all the users to own a radio. Stoop Net puts the radio at a fixed location and serves phones over WiFi instead. There's nothing to install and no account to create. Connect to the WiFi and use a browser to read or post. 

## How it works

Each node is an ESP32-S3 broadcasting an open WiFi access point with a captive portal. Phones connect, see the board, and can read or post without installing anything. Posts made locally are stored on the node and forwarded to other Stoop Net nodes over LoRa. Reads never touch the radio; only writes do.

The mesh has very little bandwidth to spend. The whole network can carry a few thousand SMS-length posts a day. This behaves like a village noticeboard with a strict word limit: post length is capped, and every post competes for the same shared airtime.

## Trust model

**Phone to node.** WiFi is open, there are no accounts, and a username is just a label someone typed in, with nothing behind it. Anyone in range can post as anyone, but the username is appended with the site name.

**Node to node.** The main Stoop Net network is private to the nodes and is encrypted by the standard meshcore transport. MeshCore channels encrypt traffic but don't attribute a message to a sender, so attribution happens at the application layer instead of being inherited from the transport.

A post renders as `name@node`. The node half is static. The name half is just text someone typed. Forging another node's identity is generally not possible. Standing at a node and posting under a neighbor's name is possible, and that's an accepted tradeoff for a system with no accounts considering imposters will be sharing the same physical space.

The channel itself uses a private, randomly generated secret rather than one derived from its name, and rotating that secret is a routine config change.

## Rate limits

There are a lot of people on Meshcore in SoCal. In order to be respectful of the airspace, rate limits for both users and nodes have been implemented on the firmware level. It's built on a bucket system so a user starts with a max number of messages (5) and gets a new one back every 30 seconds. The node operates on a similar system.

## Staying useful on a normal day

A tool that only works during a disaster has no users on day one of that disaster, because nobody has connected to it before. Stoop Net nodes are meant to carry routine, low-stakes content too, so people already know the SSID and the hardware has been exercised before it matters.

## Constraints worth knowing about

- No internet connection, ever, so no CDNs and no external assets. Everything the browser needs ships inside the firmware.
- No TLS, so nothing sensitive should be typed into this browser.
- Only a handful of WiFi clients can be connected at once, around 4 to 8.
- Pages render inside the captive portal WebView on iOS, so plain HTML and light JavaScript, not a framework.
- Web assets are gzipped and embedded into the firmware at build time; see `bin/embed_web.py`.

## Building

This is a PlatformIO project. The current Stoop Net firmware target is `heltec_v4_stoop_radio`:

```
pio run -e heltec_v4_stoop_radio
```

There is a second target for a color-LCD node, the LilyGo T-Deck:

```
pio run -e t_deck_stoop_radio
```

It builds the same firmware, but opts into `STOOP_QR_JOIN`, which makes the
T-Deck's 320x240 screen lead with a scan-to-join QR code for its access point
instead of the message counter, and keeps the display on (`AUTO_OFF_MILLIS=0`)
so the code is there without anyone touching the node. The code is stamped as
an XBM bitmap rather than drawn with scaled rectangles, because the panel
scales 2.5x horizontally and 3.75x vertically and rect-drawn modules end up on
a fractional grid with hairline seams that break decoding. The QR is pinned to
version 2, which caps the SSID at 14 characters — see
`test/client-esp-32/README.md`.

For active development, `stoop_dev` builds the same firmware with debug logging enabled and uploads plus opens a serial monitor automatically:

```
pio run -e stoop_dev
```

To make the `stoop` channel private, copy `platformio.local.ini.template` to `platformio.local.ini` (already gitignored) and set your own channel key there.

## Testing

Two layers, and it is worth knowing which one you are running.

**Host-side unit tests** need no hardware and run in CI (`.github/workflows/run-unit-tests.yml`):

```
pio test -e native -e native_kiss_modem
```

**The ESP32 test rig** (`test/client-esp-32/`) is a set of small boards that
verify a real node end-to-end: they join a node's access point, exercise the
captive portal and web API over HTTP, and print machine-parsable
`SELFTEST|name=...|result=PASS|FAIL` lines that the host scripts turn into a
verdict. With two nodes and two clients attached at once, `mesh_flow.sh` also
proves a post crosses from one node to the other over the LoRa mesh.

```
cd test/client-esp-32
./scripts/run.sh test          # host-side suite, no device needed (63 tests)
./scripts/run.sh ports         # where each board is attached
./scripts/run.sh flash-nodes   # flash both nodes, APs Stoop-1 / Stoop-2
./scripts/run.sh flash-clients # flash both test clients
./scripts/run.sh mesh-flow     # post via one node, verify it via the other
```

The rig's own Python unit tests — the verdict parser, USB device
classification, the serial CLI, the log analyzer, and the `platformio.ini`
invariants that keep the clients join-compatible with the node firmware — run
in CI on every push via `test-rig-host-tests.yml`. The on-device suites need
the physical hardware and are **not** covered by CI.

Full rig documentation, including what each on-device test checks and the
known gaps, is in [`test/client-esp-32/README.md`](test/client-esp-32/README.md).

## Repo layout

Stoop Net is a fork of MeshCore and stays mergeable with upstream on purpose. All Stoop Net-specific code lives under `examples/stoop_net_radio/`; shared MeshCore source under `src/` is not modified.

```
examples/stoop_net_radio/
  main.cpp             setup/loop, WiFi AP, captive portal, HTTP routes
  MyMesh.cpp/.h         mesh behavior for this node
  RateLimiter.cpp/.h    the two token buckets described above
  ui-new/               on-device UI; STOOP_QR_JOIN adds the scan-to-join
                        QR code on the T-Deck build
  web/                  the HTML and JS served to phones
test/client-esp-32/     test clients (M5StickC, ESP32-S3 kit) + scripts to flash
                        the two-node rig (APs Stoop-1, Stoop-2) and verify
                        message flow end-to-end (see test/client-esp-32/README.md)
```

## Status

A user can connect to the WiFi hotspot and is taken to the main page by a captive portal. The user can specify a username and send messages over the private stoop channel. They can search through previous messages. 

## ToDo
- need to add an SD card to persist messages through reboots and add the ability to save 100s or 1000s of messages without competing with ESP flash.
- need to stress test the system with multiple phones connected and sending messages.
- want to add another node type as a weather station or other types of admin data that can be published to the network.

## AI Disclaimer
The firmware has all been almost entirely written by hand, but I'm not very experienced with web dev so I mostly used AI for that. Some of the FW is copied from reference sources. I've reviewed the JS parts myself, but they have been written by Claude.
