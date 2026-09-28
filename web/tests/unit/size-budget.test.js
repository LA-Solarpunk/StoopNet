/**
 * Unit tests for the size budget helpers used by SizeBudgetPlugin.
 *
 * These are pure-logic tests (node environment, no DOM, no webpack) per
 * the vitest configuration; the plugin class itself is exercised by the
 * production build.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  BYTES_PER_MIB,
  directorySize,
  listOutputFiles,
  classifyBudget,
  formatBytes,
} from '../../scripts/size-budget-plugin.js';

const tempDirs = [];

/**
 * Create a unique temp directory and register it for cleanup.
 *
 * @param {string} prefix mkdtemp prefix
 * @returns {string} Path to the created directory
 */
function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Write a file of an exact size (contents don't matter, size does).
 *
 * @param {string} dir Target directory
 * @param {string} name File name
 * @param {number} size File size in bytes
 * @returns {void}
 */
function writeFileOfSize(dir, name, size) {
  fs.writeFileSync(path.join(dir, name), Buffer.alloc(size, 'x'));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('directorySize', () => {
  it('sums nested file sizes exactly', () => {
    const dir = makeTempDir('budget-nested-');
    fs.mkdirSync(path.join(dir, 'sub'));
    writeFileOfSize(dir, 'index.html', 100);
    writeFileOfSize(path.join(dir, 'sub'), 'index.js', 2000);
    writeFileOfSize(path.join(dir, 'sub'), 'chunk.js', 3000);

    expect(directorySize(dir)).toBe(5100);
  });

  it('returns 0 for an empty directory', () => {
    const dir = makeTempDir('budget-empty-');

    expect(directorySize(dir)).toBe(0);
  });

  it('ignores directories without recursing into non-directory entries', () => {
    const dir = makeTempDir('budget-mixed-');
    writeFileOfSize(dir, 'a.js', 10);
    fs.symlinkSync(path.join(dir, 'a.js'), path.join(dir, 'link.js'));

    // Symlinks are not regular files, so only a.js counts.
    expect(directorySize(dir)).toBe(10);
  });
});

describe('listOutputFiles', () => {
  it('lists relative paths sorted largest first', () => {
    const dir = makeTempDir('budget-list-');
    fs.mkdirSync(path.join(dir, 'chunks'));
    writeFileOfSize(dir, 'small.js', 10);
    writeFileOfSize(dir, 'big.js', 999);
    writeFileOfSize(path.join(dir, 'chunks'), 'mod.bin', 100);

    expect(listOutputFiles(dir)).toEqual([
      { file: 'big.js', size: 999 },
      { file: path.join('chunks', 'mod.bin'), size: 100 },
      { file: 'small.js', size: 10 },
    ]);
  });

  it('returns an empty list for an empty directory', () => {
    const dir = makeTempDir('budget-list-empty-');

    expect(listOutputFiles(dir)).toEqual([]);
  });
});

describe('classifyBudget', () => {
  const warnBytes = 2000;
  const errorBytes = 3000;

  it('is ok below the warn threshold', () => {
    expect(classifyBudget(1999, warnBytes, errorBytes)).toBe('ok');
  });

  it('is ok exactly at the warn threshold ("larger than" triggers)', () => {
    expect(classifyBudget(2000, warnBytes, errorBytes)).toBe('ok');
  });

  it('warns above the warn threshold but below the error threshold', () => {
    expect(classifyBudget(2001, warnBytes, errorBytes)).toBe('warn');
    expect(classifyBudget(2999, warnBytes, errorBytes)).toBe('warn');
  });

  it('still warns exactly at the error threshold', () => {
    expect(classifyBudget(3000, warnBytes, errorBytes)).toBe('warn');
  });

  it('errors above the error threshold', () => {
    expect(classifyBudget(3001, warnBytes, errorBytes)).toBe('error');
    expect(classifyBudget(99999, warnBytes, errorBytes)).toBe('error');
  });
});

describe('formatBytes', () => {
  it('formats bytes below 1 KiB as plain bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kibibytes', () => {
    expect(formatBytes(1024)).toBe('1.00 KiB');
    expect(formatBytes(2048)).toBe('2.00 KiB');
  });

  it('formats mebibytes', () => {
    expect(formatBytes(3 * 1024 * 1024 + 512 * 1024)).toBe('3.50 MiB');
    expect(formatBytes(BYTES_PER_MIB)).toBe('1.00 MiB');
  });

  it('formats gibibytes', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GiB');
  });
});
