/**
 * Counter Logic
 *
 * Pure state-transition functions for the counter component, extracted so
 * they can be unit tested (and mutation tested) without a browser or DOM.
 *
 * For LLMs: This is the canonical pattern for testable code in this
 * template — keep business logic in pure functions in a `*-logic.js`
 * module, and let the custom element (`counter-component.js`) be a thin
 * shell that wires DOM events to these functions. Unit tests in
 * `tests/unit/` and mutation tests (Stryker) target these pure modules.
 */

/**
 * Return the count after an increment.
 *
 * @param {number} count - The current count
 * @returns {number} The count plus one
 */
export function increment(count) {
  return count + 1;
}

/**
 * Return the count after a decrement.
 *
 * @param {number} count - The current count
 * @returns {number} The count minus one
 */
export function decrement(count) {
  return count - 1;
}

/**
 * Return the count after a reset.
 *
 * @returns {number} Always zero
 */
export function reset() {
  return 0;
}
