/**
 * Size Budget Plugin for Webpack
 *
 * Measures everything written to the output directory after a build and
 * enforces the project's distribution size budget:
 *
 *   - total > warnBytes  → webpack warning (build still succeeds)
 *   - total > errorBytes → webpack error (build fails with a non-zero exit)
 *
 * The pure helpers (directorySize, listOutputFiles, classifyBudget,
 * formatBytes) are kept free of webpack imports so they can be unit
 * tested with vitest.
 *
 * @module size-budget-plugin
 */

import fs from 'fs';
import path from 'path';

/** Bytes per MiB. Sizes are measured on disk, matching firmware partition sizing. */
export const BYTES_PER_MIB = 1024 * 1024;

/**
 * Recursively sum the size of every regular file in a directory.
 *
 * @param {string} dir Absolute path to the directory to measure
 * @returns {number} Total size in bytes (0 for an empty directory)
 */
export function directorySize(dir) {
  let total = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  };
  walk(dir);
  return total;
}

/**
 * List every file under a directory with its size, largest first.
 *
 * @param {string} dir Absolute path to the directory to scan
 * @returns {Array<{file: string, size: number}>} Relative paths and byte sizes
 */
export function listOutputFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push({ file: path.relative(dir, fullPath), size: fs.statSync(fullPath).size });
      }
    }
  };
  walk(dir);
  return files.sort((a, b) => b.size - a.size);
}

/**
 * Classify a total size against the budget.
 *
 * Thresholds are exclusive ("larger than" triggers): a total of exactly
 * warnBytes is "ok", and a total of exactly errorBytes is still only a
 * warning.
 *
 * @param {number} totalBytes Measured output size in bytes
 * @param {number} warnBytes Warn threshold in bytes
 * @param {number} errorBytes Error threshold in bytes
 * @returns {'ok'|'warn'|'error'} The strictest threshold exceeded
 */
export function classifyBudget(totalBytes, warnBytes, errorBytes) {
  if (totalBytes > errorBytes) return 'error';
  if (totalBytes > warnBytes) return 'warn';
  return 'ok';
}

/**
 * Format a byte count for humans, using binary units (KiB / MiB / GiB).
 *
 * @param {number} bytes Size in bytes
 * @returns {string} Formatted size, e.g. "2.05 MiB"
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 'B';
  for (const next of ['KiB', 'MiB', 'GiB']) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value.toFixed(2)} ${unit}`;
}

/**
 * Webpack plugin that enforces the size budget after each build.
 */
export class SizeBudgetPlugin {
  /**
   * @param {object} [options]
   * @param {number} [options.warnBytes] Warn above this many bytes (default 2 MiB)
   * @param {number} [options.errorBytes] Fail the build above this many bytes (default 3 MiB)
   */
  constructor({ warnBytes = 2 * BYTES_PER_MIB, errorBytes = 3 * BYTES_PER_MIB } = {}) {
    this.warnBytes = warnBytes;
    this.errorBytes = errorBytes;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync('SizeBudgetPlugin', (compilation, callback) => {
      try {
        const { WebpackError } = compiler.webpack;
        const outputDir = compiler.options.output.path;
        const totalBytes = directorySize(outputDir);
        const verdict = classifyBudget(totalBytes, this.warnBytes, this.errorBytes);

        if (verdict === 'ok') {
          const limits = `warn above ${formatBytes(this.warnBytes)}, fail above ${formatBytes(this.errorBytes)}`;
          console.log(`[size-budget] ${outputDir}: ${formatBytes(totalBytes)} (${limits})`);
        } else {
          // A per-file breakdown (largest first) makes it obvious where to cut.
          const breakdown = listOutputFiles(outputDir)
            .map(({ file, size }) => `  ${formatBytes(size).padStart(12)}  ${file}`)
            .join('\n');
          const message =
            `[size-budget] output is ${formatBytes(totalBytes)} in ${outputDir} ` +
            `(limits: warn above ${formatBytes(this.warnBytes)}, ` +
            `fail above ${formatBytes(this.errorBytes)})\n` +
            `Files:\n${breakdown}`;
          if (verdict === 'error') {
            compilation.errors.push(new WebpackError(
              `${message}\nBuild failed: shrink the output below the error limit before shipping.`
            ));
          } else {
            compilation.warnings.push(new WebpackError(
              `${message}\nBuild succeeded, but the output is past the warn limit.`
            ));
          }
        }
        callback();
      } catch (error) {
        callback(error);
      }
    });
  }
}
