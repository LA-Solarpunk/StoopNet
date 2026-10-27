# Vendored crypto libraries

Fetched unmodified from unpkg on 2026-10-26, for the admin alert signing/KDF
flow in `web/admin.html`. No internet access at a deployed node, so these
ship inside the firmware like the rest of `web/`.

| File | Package | Source |
|---|---|---|
| `ed25519.js` | `@noble/ed25519@3.2.0` | https://unpkg.com/@noble/ed25519@3.2.0/index.js |
| `argon2.js` | `@noble/hashes@2.4.0` | https://unpkg.com/@noble/hashes@2.4.0/argon2.js |
| `blake2.js` | `@noble/hashes@2.4.0` | https://unpkg.com/@noble/hashes@2.4.0/blake2.js |
| `sha2.js` | `@noble/hashes@2.4.0` | https://unpkg.com/@noble/hashes@2.4.0/sha2.js |
| `utils.js` | `@noble/hashes@2.4.0` | https://unpkg.com/@noble/hashes@2.4.0/utils.js |
| `_blake.js` | `@noble/hashes@2.4.0` | https://unpkg.com/@noble/hashes@2.4.0/_blake.js |
| `_md.js` | `@noble/hashes@2.4.0` | https://unpkg.com/@noble/hashes@2.4.0/_md.js |
| `_u64.js` | `@noble/hashes@2.4.0` | https://unpkg.com/@noble/hashes@2.4.0/_u64.js |

Only `argon2id` and `sha512` are used out of `@noble/hashes`; these are the
full transitive dependency set those two need (`argon2.js` -> `blake2.js` ->
`_blake.js`/`_md.js`/`utils.js`; `sha2.js` -> `_md.js`/`_u64.js`/`utils.js`).
The rest of each package (sha3, scrypt, pbkdf2, etc.) was left out to keep
the embedded firmware image small.

`@noble/ed25519`'s default async API (`getPublicKeyAsync`/`signAsync`) uses
`crypto.subtle`, which browsers only expose on secure contexts (HTTPS or
localhost) -- this site is plain HTTP by design (see README "Constraints"),
so `crypto.subtle` is unavailable. `admin.html` uses the sync API instead
(`getPublicKey`/`sign`) with `ed.hashes.sha512` wired to `@noble/hashes`'
`sha512`, which is exactly why noble-hashes is vendored alongside
noble-ed25519 rather than relying on its dependency-free async default.

To update: re-fetch the same file list at a newer version, re-run
`tools/stoop_keygen.py --selftest` against the admin page's
`__stoopKeygenSelfTest()` in a browser console, and confirm the seed/pubkey
hex still match before committing.
