#!/usr/bin/env python3
# Generates a MeshCore group channel key (PSK), either a random private
# channel or a public "hashtag" channel derived from its name.
#
#   python3 tools/stoop_channel_keygen.py private --name "My Channel"
#   python3 tools/stoop_channel_keygen.py hashtag "#test"
#
# Conventions (docs/companion_protocol.md):
#   private channel: a random 16-byte (or --bits 256) secret.
#   hashtag channel:  secret = sha256(name)[:16] -- anyone who knows/guesses
#                      the name can derive the same key. Not private.
#
# addChannel()/setChannel() (src/helpers/BaseChatMesh.cpp) accept a base64
# secret of exactly 16 or 32 raw bytes; that's the format firmware wants.

import argparse
import base64
import hashlib
import os
import sys
import urllib.parse


def private_secret(bits: int) -> bytes:
    return os.urandom(bits // 8)


def hashtag_secret(name: str) -> bytes:
    return hashlib.sha256(name.encode("utf-8")).digest()[:16]


def print_result(name: str, secret: bytes, note: str = None):
    secret_hex = secret.hex()
    secret_b64 = base64.b64encode(secret).decode("ascii")

    print(f"name:            {name}")
    print(f"secret (hex):    {secret_hex}")
    print(f"secret (base64): {secret_b64}")
    print()
    print(f'addChannel("{name}", "{secret_b64}");')
    print()
    uri = "meshcore://channel/add?name={}&secret={}".format(
        urllib.parse.quote(name), secret_hex
    )
    print(f"share/scan link: {uri}")
    print_ascii_qr(uri)

    if note:
        print()
        print(note)


def print_ascii_qr(data: str):
    try:
        import qrcode
    except ImportError:
        return
    print()
    qr = qrcode.QRCode(border=1)
    qr.add_data(data)
    qr.print_ascii()


def main():
    parser = argparse.ArgumentParser(
        description="Generate a MeshCore channel key: a random private channel, "
                     "or a public hashtag channel derived from its name."
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    private_p = sub.add_parser("private", help="random secret for a new private channel")
    private_p.add_argument("--name", default="Private Channel", help="channel display name")
    private_p.add_argument("--bits", type=int, choices=(128, 256), default=128,
                            help="secret size (default: 128, matching every existing convention in this repo)")

    hashtag_p = sub.add_parser("hashtag", help="derive a public channel's key from its name")
    hashtag_p.add_argument("name", help='channel name, e.g. "#test" (the "#" is auto-added if missing)')

    args = parser.parse_args()

    if args.mode == "private":
        secret = private_secret(args.bits)
        print_result(args.name, secret)
    else:
        name = args.name if args.name.startswith("#") else "#" + args.name
        if name != args.name:
            print(f"note: using \"{name}\" -- hashtag channel names start with '#'", file=sys.stderr)
        secret = hashtag_secret(name)
        print_result(
            name, secret,
            note="This is a PUBLIC channel: traffic is encrypted on air, but anyone who\n"
                 "knows or guesses the name \"{}\" can derive this same key. Don't use it\n"
                 "for anything that needs to stay private -- use the \"private\" mode for that.".format(name),
        )


if __name__ == "__main__":
    main()
