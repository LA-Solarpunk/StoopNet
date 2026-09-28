/**
 * Unit tests for src/stoop-id-logic.js
 *
 * Crypto expectations use published test vectors:
 *   - PBKDF2-HMAC-SHA256: RFC 7914 §11 (P="password", S="salt", c=1 and c=2)
 *   - HMAC-SHA-256: RFC 4231 §2.2 test case 2 (key "Jefe"), truncated to 7
 */

import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEYS,
  SIGNATURE_LENGTH,
  bytesToHex,
  clearIdentity,
  deriveSigningKey,
  hexToBytes,
  loadIdentity,
  randomSalt,
  readSignatureKey,
  readUsername,
  saveIdentity,
  signMessage,
  truncate,
} from '../../src/stoop-id-logic.js';

/** Minimal localStorage stand-in so tests run in plain node. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('bytesToHex / hexToBytes', () => {
  it('converts bytes to lowercase hex', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xa1]))).toBe('000fa1');
    expect(bytesToHex(new Uint8Array([]))).toBe('');
  });

  it('round-trips through hexToBytes', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(Array.from(hexToBytes(bytesToHex(bytes)))).toEqual(Array.from(bytes));
  });

  it('decodes known hex', () => {
    expect(Array.from(hexToBytes('73616c74'))).toEqual([
      0x73, 0x61, 0x6c, 0x74,
    ]);
  });
});

describe('truncate', () => {
  it('keeps the first SIGNATURE_LENGTH characters by default', () => {
    expect(truncate('abcdef0123456')).toBe('abcdef0');
    expect(truncate('abcdef0123456').length).toBe(SIGNATURE_LENGTH);
  });

  it('honors an explicit length and short inputs', () => {
    expect(truncate('abcdef0123', 4)).toBe('abcd');
    expect(truncate('abc', 7)).toBe('abc');
  });
});

describe('randomSalt', () => {
  it('returns hex of the requested size', () => {
    const salt = randomSalt(16);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSalt(8)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces different salts on each call', () => {
    expect(randomSalt()).not.toBe(randomSalt());
  });
});

describe('deriveSigningKey', () => {
  const salt = '73616c74'; // ASCII "salt"

  it('matches RFC 7914 vector (c=1)', async () => {
    const key = await deriveSigningKey('password', salt, 1);
    expect(key).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'
    );
  });

  it('matches RFC 7914 vector (c=2)', async () => {
    const key = await deriveSigningKey('password', salt, 2);
    expect(key).toBe(
      'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43'
    );
  });

  it('is deterministic and 256-bit for the default iterations', async () => {
    const a = await deriveSigningKey('porch-secret', 'aabbccdd');
    const b = await deriveSigningKey('porch-secret', 'aabbccdd');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the password and with the salt', async () => {
    const base = await deriveSigningKey('porch-secret', 'aabbccdd', 1000);
    expect(await deriveSigningKey('porch-Secret', 'aabbccdd', 1000)).not.toBe(base);
    expect(await deriveSigningKey('porch-secret', '11223344', 1000)).not.toBe(base);
  });
});

describe('signMessage', () => {
  it('matches RFC 4231 test case 2 truncated to 7 characters', async () => {
    // Key = "Jefe", data = "what do ya want for nothing?"
    const sig = await signMessage('4a656665', 'what do ya want for nothing?');
    expect(sig).toBe('5bdcc14');
  });

  it('returns exactly 7 lowercase hex characters', async () => {
    const sig = await signMessage('aabbccdd', 'Hello neighbors!');
    expect(sig).toMatch(/^[0-9a-f]{7}$/);
    expect(sig.length).toBe(SIGNATURE_LENGTH);
  });

  it('is deterministic per message and sensitive to the message', async () => {
    const key = await deriveSigningKey('porch-secret', 'aabbccdd', 1000);
    expect(await signMessage(key, 'Hello!')).toBe(await signMessage(key, 'Hello!'));
    expect(await signMessage(key, 'Hello!')).not.toBe(await signMessage(key, 'Hello?'));
  });

  it('changes when the signing key changes', async () => {
    const keyA = await deriveSigningKey('alice', 'aabbccdd', 1000);
    const keyB = await deriveSigningKey('bob', 'aabbccdd', 1000);
    expect(await signMessage(keyA, 'same text'))
      .not.toBe(await signMessage(keyB, 'same text'));
  });
});

describe('identity storage', () => {
  const identity = {
    username: 'alice',
    salt: 'aabbccdd',
    key: '1122334455667788',
  };

  it('saves and loads an identity', () => {
    const storage = fakeStorage();
    saveIdentity(identity, storage);
    expect(loadIdentity(storage)).toEqual(identity);
    expect(storage.getItem(STORAGE_KEYS.USERNAME)).toBe('alice');
  });

  it('returns null when any part is missing', () => {
    const storage = fakeStorage();
    expect(loadIdentity(storage)).toBeNull();
    saveIdentity(identity, storage);
    storage.removeItem(STORAGE_KEYS.KEY);
    expect(loadIdentity(storage)).toBeNull();
  });

  it('clears every identity key', () => {
    const storage = fakeStorage();
    saveIdentity(identity, storage);
    clearIdentity(storage);
    expect(loadIdentity(storage)).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.SALT)).toBeNull();
  });

  it('readUsername and readSignatureKey default to empty strings', () => {
    const storage = fakeStorage();
    expect(readUsername(storage)).toBe('');
    expect(readSignatureKey(storage)).toBe('');
    saveIdentity(identity, storage);
    expect(readUsername(storage)).toBe('alice');
    expect(readSignatureKey(storage)).toBe(identity.key);
  });
});

describe('full signing round trip', () => {
  it('signs a message and reads the signature back off it', async () => {
    const key = await deriveSigningKey('porch-secret', 'aabbccdd', 1000);
    const sig = await signMessage(key, 'Porch sale Saturday!');
    const signed = `Porch sale Saturday! #${sig}`;
    expect(signed).toMatch(/ #[0-9a-f]{7}$/);
    expect(signed.slice(-SIGNATURE_LENGTH)).toBe(sig);
  });
});
