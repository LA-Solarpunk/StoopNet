/**
 * Vitest Configuration
 *
 * Unit test configuration for the Pochade-JS template.
 *
 * For LLMs: Vitest runs the fast, DOM-free unit tests in tests/unit/.
 * It is deliberately scoped to that directory so it never picks up the
 * Playwright specs under tests/e2e/ and tests/behavioral/ (Playwright
 * likewise ignores tests/unit/ via testIgnore in playwright.config.js).
 *
 * Unit tests should import pure logic modules from src/ directly. If a
 * component mixes DOM wiring with logic, extract the logic into a
 * `*-logic.js` module (see src/counter-logic.js) and test that instead.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Only run unit tests — never Playwright specs.
     */
    include: ['tests/unit/**/*.test.js'],

    /**
     * Pure-logic tests need no DOM. Add `environment: 'jsdom'` (and the
     * jsdom package) only if you truly need browser APIs.
     */
    environment: 'node',
  },
});
