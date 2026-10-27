#!/usr/bin/env python3
# Derives the StoopNet admin Ed25519 keypair from a passphrase.
#
#   pip install -r tools/requirements.txt
#   echo -n '<passphrase>' | python3 tools/stoop_keygen.py
#
# seed = Argon2id(passphrase, salt="stoop-admin-v1", 64MB, t=3, p=1, 32 bytes)
# keypair = Ed25519 from seed
#
# This MUST match examples/stoop_net_radio/web/vendor/*.js byte for byte --
# see --selftest below. If the browser ever signs an alert this script can't
# reproduce, the two have drifted out of sync.

import argparse
import sys
import unicodedata
from getpass import getpass

from argon2.low_level import Type, hash_secret_raw
from nacl.signing import SigningKey

SALT = b"stoop-admin-v1"
TIME_COST = 3
MEMORY_COST_KIB = 64 * 1024  # argon2's native unit is KiB; 64MB = 65536 KiB
PARALLELISM = 1
SEED_LEN = 32

# Fixed, public, not meant to protect anything -- only used so the browser's
# own self-test can be run against the exact same input and compared by eye.
SELFTEST_PASSPHRASE = "stoop-selftest-do-not-use"


def derive_seed(passphrase: str) -> bytes:
    # NFC-normalize so the same passphrase typed on different keyboards/IMEs
    # (e.g. precomposed vs. combining accents) still derives the same seed.
    normalized = unicodedata.normalize("NFC", passphrase)
    return hash_secret_raw(
        secret=normalized.encode("utf-8"),
        salt=SALT,
        time_cost=TIME_COST,
        memory_cost=MEMORY_COST_KIB,
        parallelism=PARALLELISM,
        hash_len=SEED_LEN,
        type=Type.ID,
    )


def derive_pubkey_hex(passphrase: str) -> str:
    seed = derive_seed(passphrase)
    return SigningKey(seed).verify_key.encode().hex()


def read_passphrase_from_stdin() -> str:
    if sys.stdin.isatty():
        passphrase = getpass("Passphrase: ")
    else:
        line = sys.stdin.readline()
        if not line:
            sys.exit("error: no passphrase on stdin")
        passphrase = line.rstrip("\r\n")
    if not passphrase:
        sys.exit("error: empty passphrase")
    return passphrase


def main():
    parser = argparse.ArgumentParser(
        description="Derive the StoopNet admin Ed25519 keypair from a passphrase. "
                     "The passphrase is read from stdin, never from argv."
    )
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="derive from a fixed, publicly-known passphrase instead of reading "
             "stdin, and print the seed too, so the result can be compared "
             "directly against the browser's self-test output",
    )
    args = parser.parse_args()

    if args.selftest:
        seed = derive_seed(SELFTEST_PASSPHRASE)
        pubkey_hex = SigningKey(seed).verify_key.encode().hex()
        print(f"passphrase: {SELFTEST_PASSPHRASE!r}")
        print(f"seed (hex):   {seed.hex()}")
        print(f"pubkey (hex): {pubkey_hex}")
        print()
        print("Compare against the browser: open the admin page, open the")
        print("devtools console, and run:")
        print("    await __stoopKeygenSelfTest()")
        print("Its seed and pubkey hex must match the two lines above exactly.")
        return

    passphrase = read_passphrase_from_stdin()
    pubkey_hex = derive_pubkey_hex(passphrase)
    print(f"pubkey (hex): {pubkey_hex}")
    print()
    print(f"-D STOOP_ADMIN_PUBKEY='\"{pubkey_hex}\"'")


if __name__ == "__main__":
    main()
