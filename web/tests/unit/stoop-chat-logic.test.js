/**
 * Unit tests for src/stoop-chat-logic.js
 *
 * formatTime tests pin process.env.TZ = 'UTC' so the formatted strings are
 * deterministic regardless of the machine running the tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  DEFAULT_CHANNEL,
  SIGNATURE_OVERHEAD_BYTES,
  appendSignature,
  filterMessages,
  formatTime,
  parseMaxMessageBytes,
  remainingCharacters,
  splitSender,
  splitSignature,
  utf8Length,
} from '../../src/stoop-chat-logic.js';

beforeAll(() => {
  process.env.TZ = 'UTC';
});

const MESSAGES = [
  { text: 'alice: Porch sale Saturday! #dec0de5', ts: 1622548861 },
  { text: 'sam: Anyone have a spare charger?', ts: 1622548921 },
  { text: 'alice: Found it, thanks!', ts: 1622548981 },
];

describe('splitSender', () => {
  it('splits "sender: body"', () => {
    expect(splitSender('alice: hello')).toEqual({
      sender: 'alice',
      body: 'hello',
    });
  });

  it('splits only on the first ": "', () => {
    expect(splitSender('alice: hello: world')).toEqual({
      sender: 'alice',
      body: 'hello: world',
    });
  });

  it('returns null sender when there is no ": "', () => {
    expect(splitSender('no sender here')).toEqual({
      sender: null,
      body: 'no sender here',
    });
    expect(splitSender('alice:hello')).toEqual({
      sender: null,
      body: 'alice:hello',
    });
  });
});

describe('formatTime', () => {
  it('returns empty for missing or pre-2020 timestamps', () => {
    expect(formatTime(0)).toBe('');
    expect(formatTime(undefined)).toBe('');
    expect(formatTime(1599999999)).toBe('');
  });

  it('formats post-2020 timestamps in en-US', () => {
    // 1622548861 = 2021-06-01T12:01:01Z
    expect(formatTime(1622548861, 'en-US')).toBe('12:01 PM');
    // 1600000000 = 2020-09-13T12:26:40Z
    expect(formatTime(1600000000, 'en-US')).toBe('12:26 PM');
  });
});

describe('filterMessages', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterMessages(MESSAGES, '')).toHaveLength(3);
    expect(filterMessages(MESSAGES, '   ')).toHaveLength(3);
  });

  it('matches case-insensitively across sender and body', () => {
    expect(filterMessages(MESSAGES, 'ALICE')).toHaveLength(2);
    expect(filterMessages(MESSAGES, 'charger')).toHaveLength(1);
  });

  it('returns no matches for a query nothing contains', () => {
    expect(filterMessages(MESSAGES, 'zamboni')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const copy = MESSAGES.slice();
    filterMessages(MESSAGES, '');
    expect(MESSAGES).toEqual(copy);
  });
});

describe('appendSignature / splitSignature', () => {
  it('appends a space + # + signature at the end', () => {
    expect(appendSignature('Hello!', '3f9a2c1')).toBe('Hello! #3f9a2c1');
  });

  it('splits a signed body back apart', () => {
    expect(splitSignature('Hello! #3f9a2c1')).toEqual({
      body: 'Hello!',
      signature: '3f9a2c1',
    });
  });

  it('reports null for unsigned bodies', () => {
    expect(splitSignature('no signature')).toEqual({
      body: 'no signature',
      signature: null,
    });
  });

  it('requires exactly 7 hex characters after " #"', () => {
    // 8 hex characters: not a signature
    expect(splitSignature('hi #deadbeef')).toEqual({
      body: 'hi #deadbeef',
      signature: null,
    });
    // non-hex: not a signature
    expect(splitSignature('nice #zzz9999').signature).toBeNull();
    // no space: plain text
    expect(splitSignature('hi#3f9a2c1').signature).toBeNull();
  });

  it('round-trips append → split', () => {
    const text = 'Porch sale at 9!';
    const sig = 'dec0de5';
    const round = splitSignature(appendSignature(text, sig));
    expect(round.body).toBe(text);
    expect(round.signature).toBe(sig);
  });
});

describe('utf8Length / remainingCharacters', () => {
  it('measures UTF-8 bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('😀')).toBe(4);
    expect(utf8Length('')).toBe(0);
  });

  it('counts remaining bytes against the budget', () => {
    expect(remainingCharacters('abc', 128)).toBe(125);
    expect(remainingCharacters('', 128)).toBe(128);
    expect(remainingCharacters('x'.repeat(130), 128)).toBe(-2);
  });

  it('reserves room for the signature when the draft will be signed', () => {
    expect(SIGNATURE_OVERHEAD_BYTES).toBe(9); // " #" + 7 hex
    expect(remainingCharacters('abc', 128, true)).toBe(128 - 3 - 9);
    expect(remainingCharacters('abc', 11, true)).toBe(-1);
  });
});

describe('parseMaxMessageBytes', () => {
  it('parses positive integers', () => {
    expect(parseMaxMessageBytes('256')).toBe(256);
    expect(parseMaxMessageBytes('  128\n')).toBe(128);
  });

  it('rejects junk and non-positive values', () => {
    expect(parseMaxMessageBytes('not a number')).toBeNull();
    expect(parseMaxMessageBytes('0')).toBeNull();
    expect(parseMaxMessageBytes('-5')).toBeNull();
    expect(parseMaxMessageBytes('')).toBeNull();
  });
});

describe('DEFAULT_CHANNEL', () => {
  it('matches the node channel name', () => {
    expect(DEFAULT_CHANNEL).toBe('stoop');
  });
});
