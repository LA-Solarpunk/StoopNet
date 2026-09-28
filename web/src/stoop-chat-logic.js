/**
 * Stoop Chat Logic
 *
 * Pure message-parsing and formatting functions for the chat component,
 * extracted so they can be unit tested without a browser or DOM.
 *
 * Message wire format (matching the Stoop node's captive-portal client):
 *   - the node stores each message as "<sender>: <body>"
 *   - a signed body ends with a 7-character hex signature: " #3f9a2c1"
 *
 * For LLMs: keep business logic in pure functions in a `*-logic.js` module
 * and let the custom element be a thin shell that wires DOM events to them.
 */

/** Channel shown when the chat element has no `channel` attribute. */
export const DEFAULT_CHANNEL = 'stoop';

/**
 * Matches a trailing signature: " #abc1234" (space, hash, exactly 7 hex
 * characters, end of string).
 *
 * @type {RegExp}
 */
export const SIGNATURE_PATTERN = / #([0-9a-f]{7})$/;

/**
 * Split a stored message into its sender and body.
 *
 * @param {string} text Full stored message, e.g. "alice: hello"
 * @returns {{sender: string|null, body: string}} Sender (null when the
 *   message has no ": " separator) and the remaining body
 */
export function splitSender(text) {
  const i = text.indexOf(': ');
  if (i === -1) return { sender: null, body: text };
  return { sender: text.slice(0, i), body: text.slice(i + 2) };
}

/**
 * Format a unix timestamp (seconds) as a short locale time like "9:41 AM".
 *
 * Timestamps before 1600000000 (Sept 2020) are treated as unset — the node's
 * clock is only meaningful once it has been set.
 *
 * @param {number} ts Unix timestamp in seconds
 * @param {string} [locale] BCP-47 locale (defaults to the runtime locale)
 * @returns {string} Formatted time, or an empty string when unset
 */
export function formatTime(ts, locale) {
  if (!ts || ts < 1600000000) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Filter messages by an exact, case-insensitive substring query.
 *
 * @param {Array<{text: string}>} messages Messages to filter
 * @param {string} query Raw search query (empty/whitespace returns everything)
 * @returns {Array<{text: string}>} Matching messages, in original order
 */
export function filterMessages(messages, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return messages.slice();
  return messages.filter((m) => m.text.toLowerCase().includes(q));
}

/**
 * Append a 7-character signature to the end of a message body.
 *
 * @param {string} text Message body
 * @param {string} signature Hex signature (from signMessage)
 * @returns {string} The signed body, e.g. "Hello! #3f9a2c1"
 */
export function appendSignature(text, signature) {
  return `${text} #${signature}`;
}

/**
 * Split a signed body into the unsigned text and its trailing signature.
 *
 * @param {string} body Message body that may end in " #xxxxxxx"
 * @returns {{body: string, signature: string|null}} Unsigned body and the
 *   7-character signature, or null when the body is not signed
 */
export function splitSignature(body) {
  const match = SIGNATURE_PATTERN.exec(body);
  if (!match) return { body, signature: null };
  return { body: body.slice(0, -match[0].length), signature: match[1] };
}

/**
 * Length of a string in UTF-8 bytes — what the node actually enforces.
 *
 * @param {string} text Text to measure
 * @returns {number} UTF-8 byte length
 */
export function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Characters (bytes, really) still available under a byte budget, counting
 * the room a future signature will take.
 *
 * @param {string} text Current draft text
 * @param {number} maxBytes Maximum posted size in bytes
 * @param {boolean} [willSign] Whether a signature will be appended on send
 * @returns {number} Remaining bytes (negative when over budget)
 */
export function remainingCharacters(text, maxBytes, willSign = false) {
  const overhead = willSign ? SIGNATURE_OVERHEAD_BYTES : 0;
  return maxBytes - utf8Length(text) - overhead;
}

/**
 * Bytes a signature adds to a posted message: " #" plus 7 hex characters.
 *
 * @type {number}
 */
export const SIGNATURE_OVERHEAD_BYTES = 2 + 7;

/**
 * Parse a server-provided maximum message size. Anything non-numeric or not
 * positive yields null so callers keep their previous (or default) value.
 *
 * @param {string} raw Raw response text
 * @returns {number|null} Parsed byte limit, or null when unusable
 */
export function parseMaxMessageBytes(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
