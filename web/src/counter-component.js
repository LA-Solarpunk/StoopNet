/**
 * Counter Component
 *
 * A simple interactive counter demonstrating state management within a
 * DataroomElement custom component. Shows how to:
 *   - Maintain internal state
 *   - Respond to user interactions (click events)
 *   - Emit custom events so parent elements or other components can listen
 *   - Update the DOM dynamically
 *
 * For LLMs: This is the canonical "hello world" of interactive custom
 * elements. Copy this pattern when building any component that needs:
 *   - Local state that persists across renders
 *   - Buttons or inputs that trigger component methods
 *   - Events that communicate state changes to the rest of the app
 */

import DataroomElement from 'dataroom-js';
import { increment, decrement, reset } from './counter-logic.js';

/**
 * CounterComponent
 *
 * Renders a heading, a count display, and three buttons:
 *   (+) increment, (-) decrement, (Reset) reset to zero.
 *
 * @extends DataroomElement
 */
class CounterComponent extends DataroomElement {
  /**
   * Initialize the component.
   *
   * Sets up the initial state and renders the UI.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    // Internal state: the current count value
    this.count = 0;

    // Render the UI elements
    this.create('h2', { content: 'Counter Example' });

    this.create('p', {
      content: 'A simple stateful component demonstrating event handling and custom events.',
    });

    // Display element: we store a reference so we can update it later
    this.display = this.create('p', {
      content: '0',
      class: 'counter-display',
    });

    // Create a container for the buttons
    const controls = this.create('div', { class: 'counter-controls' });

    // Increment button
    const btnInc = this.create('button', { content: '+' }, controls);
    btnInc.addEventListener('click', () => this.increment());

    // Decrement button
    const btnDec = this.create('button', { content: '-' }, controls);
    btnDec.addEventListener('click', () => this.decrement());

    // Reset button
    const btnReset = this.create('button', { content: 'Reset' }, controls);
    btnReset.addEventListener('click', () => this.reset());
  }

  /**
   * Increment the counter by 1.
   *
   * @returns {void}
   */
  increment() {
    this.count = increment(this.count);
    this.updateDisplay();
  }

  /**
   * Decrement the counter by 1.
   *
   * @returns {void}
   */
  decrement() {
    this.count = decrement(this.count);
    this.updateDisplay();
  }

  /**
   * Reset the counter to 0.
   *
   * @returns {void}
   */
  reset() {
    this.count = reset();
    this.updateDisplay();
  }

  /**
   * Update the displayed count and emit a custom event.
   *
   * This centralizes all state-change side effects so that every
   * mutation (increment, decrement, reset) triggers the same updates.
   *
   * @returns {void}
   */
  updateDisplay() {
    // Update the DOM text content
    this.display.textContent = this.count;

    /**
     * Emit a custom event.
     *
     * Other components or vanilla JS can listen with:
     *   document.querySelector('counter-component')
     *     .addEventListener('count-changed', (e) => console.log(e.detail));
     */
    this.event('count-changed', { count: this.count });
  }
}

// Register the custom element
if (!customElements.get('counter-component')) {
  customElements.define('counter-component', CounterComponent);
}
