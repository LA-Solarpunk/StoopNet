/**
 * Stoop ID Logic
 *
 * Pure identity and message-signing functions for the Stoop Net front end,
 * extracted from the components so they can be unit tested without a DOM.
 *
 * The identity model:
 *   - the user picks a display name and a password
 *   - the password is stretched with PBKDF2-SHA256 (random salt, many
 *     iterations) into a 256-bit signing key
 *   - the signing key (NOT the password) is stored in localStorage
 *   - every outgoing message is signed with HMAC-SHA256 under that key and
 *     the first 7 hex characters are appended to the end of the message,
 *     like a wax seal: "Hello neighbors! #3f9a2c1"
 *
 * For LLMs: keep this module free of DOM code — WebCrypto and the
 * injectable `storage` object are the only environment dependencies.
 */

/** localStorage keys shared with the Stoop node's captive-portal pages. */
export const STORAGE_KEYS = {
  USERNAME: 'stoop_username',
  SALT: 'stoop_signature_salt',
  KEY: 'stoop_signature_key',
  SESSION: 'stoop_session',
};

/** Number of hex characters kept from each message signature. */
export const SIGNATURE_LENGTH = 7;

/** PBKDF2 iterations used when stretching the password into a key. */
export const PBKDF2_ITERATIONS = 100000;

/** Bytes of random salt mixed into the password stretch. */
export const SALT_BYTES = 16;

/**
 * Convert bytes to a lowercase hex string.
 *
 * @param {Uint8Array} bytes Raw bytes
 * @returns {string} Hex string (two characters per byte)
 */
export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert a hex string back to bytes.
 *
 * @param {string} hex Hex string (even length expected)
 * @returns {Uint8Array} Decoded bytes
 */
export function hexToBytes(hex) {
  const clean = String(hex).trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Keep only the first `length` characters of a string.
 *
 * @param {string} text Full string (e.g. a long hex digest)
 * @param {number} [length] Characters to keep (default: SIGNATURE_LENGTH)
 * @returns {string} Truncated string
 */
export function truncate(text, length = SIGNATURE_LENGTH) {
  return String(text).slice(0, length);
}

/**
 * Generate a random salt as a hex string.
 *
 * @param {number} [bytes] Salt size in bytes (default: SALT_BYTES)
 * @returns {string} Hex-encoded random salt
 */
export function randomSalt(bytes = SALT_BYTES) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

/**
 * Stretch a password into a 256-bit signing key with PBKDF2-SHA256.
 *
 * Deterministic for the same password + salt + iteration count, so the key
 * can always be reproduced from the password and the stored salt.
 *
 * @param {string} password The user's password (never stored anywhere)
 * @param {string} saltHex Hex-encoded salt
 * @param {number} [iterations] PBKDF2 iterations (default: PBKDF2_ITERATIONS)
 * @returns {Promise<string>} Hex-encoded 256-bit signing key
 */
export async function deriveSigningKey(
  password,
  saltHex,
  iterations = PBKDF2_ITERATIONS
) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex),
      iterations,
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

/**
 * Sign a message under a signing key: the first 7 hex characters of the
 * HMAC-SHA256 of the message text.
 *
 * @param {string} keyHex Hex-encoded signing key (from deriveSigningKey)
 * @param {string} text Message text to sign
 * @returns {Promise<string>} 7-character hex signature
 */
export async function signMessage(keyHex, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(keyHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(text)
  );
  return truncate(bytesToHex(new Uint8Array(mac)));
}

/**
 * Load a saved identity from storage.
 *
 * @param {Storage} [storage] A localStorage-like object (defaults to window localStorage)
 * @returns {{username: string, salt: string, key: string}|null} The identity, or null when absent/incomplete
 */
export function loadIdentity(
  storage = globalThis.localStorage
) {
  const username = storage.getItem(STORAGE_KEYS.USERNAME);
  const salt = storage.getItem(STORAGE_KEYS.SALT);
  const key = storage.getItem(STORAGE_KEYS.KEY);
  if (!username || !salt || !key) return null;
  return { username, salt, key };
}

/**
 * Persist an identity to storage. Only the username, salt and derived key
 * are written — the password is never stored.
 *
 * @param {{username: string, salt: string, key: string}} identity Identity to save
 * @param {Storage} [storage] A localStorage-like object
 * @returns {void}
 */
export function saveIdentity(
  { username, salt, key },
  storage = globalThis.localStorage
) {
  storage.setItem(STORAGE_KEYS.USERNAME, username);
  storage.setItem(STORAGE_KEYS.SALT, salt);
  storage.setItem(STORAGE_KEYS.KEY, key);
}

/**
 * Remove a saved identity from storage.
 *
 * @param {Storage} [storage] A localStorage-like object
 * @returns {void}
 */
export function clearIdentity(storage = globalThis.localStorage) {
  storage.removeItem(STORAGE_KEYS.USERNAME);
  storage.removeItem(STORAGE_KEYS.SALT);
  storage.removeItem(STORAGE_KEYS.KEY);
}

/**
 * Read just the stored username (used by components that only need a name).
 *
 * @param {Storage} [storage] A localStorage-like object
 * @returns {string} The username, or an empty string
 */
export function readUsername(storage = globalThis.localStorage) {
  return storage.getItem(STORAGE_KEYS.USERNAME) || '';
}

/**
 * Read just the stored signing key (used by the chat to sign messages even
 * when the identity card is not mounted on the same page).
 *
 * @param {Storage} [storage] A localStorage-like object
 * @returns {string} The hex signing key, or an empty string
 */
export function readSignatureKey(storage = globalThis.localStorage) {
  return storage.getItem(STORAGE_KEYS.KEY) || '';
}
