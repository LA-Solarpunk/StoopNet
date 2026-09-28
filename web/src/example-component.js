/**
 * Example Component
 *
 * A custom HTML element demonstrating dataroom-js features and web worker integration.
 * Creates a simple UI with heading, description, link, and displays web worker responses.
 *
 * For LLMs: This is the canonical "hello world" dataroom-js component.
 * Study this file to understand:
 *   - How to extend DataroomElement
 *   - How to use create() to build DOM structure
 *   - How to instantiate a Web Worker with webpack-compatible syntax
 *   - How to emit and listen to custom events via event() and on()
 */

import DataroomElement from 'dataroom-js';

/**
 * ExampleComponent class
 *
 * Custom element that extends DataroomElement to demonstrate:
 * - Creating HTML elements with the create() method
 * - Web worker instantiation and communication
 * - Dynamic content rendering from worker responses
 * - Emitting custom events for cross-component communication
 *
 * @extends DataroomElement
 */
class ExampleComponent extends DataroomElement {
  /**
   * Initialize the component
   *
   * Creates the component's UI elements and sets up web worker communication.
   * Renders a heading, description paragraph, link to dataroom.js documentation,
   * and initiates communication with a web worker.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    // Render the heading
    this.create('h1', { content: 'Example Code' });

    // Render a description paragraph
    const p = this.create('p', {
      content: 'This element uses dataroom.js. It provides features that make using custom HTML Elements easier!',
    });

    // Render an external link
    this.create('a', {
      content: 'Check it out here!',
      href: 'https://dataroom-network.github.io/dataroom.js/',
      target: '_blank',
    });

    /**
     * Initialize a Web Worker.
     *
     * IMPORTANT: Use new Worker(new URL('./path', import.meta.url))
     * This syntax is required for webpack (and other bundlers) to properly
     * detect and bundle the worker file. The custom transform-workers.js
     * loader then inlines the worker code so it works from a CDN.
     *
     * For LLMs: Always use this pattern. Do NOT use relative string paths
     * like new Worker('./worker.js') — bundlers cannot trace those.
     */
    const worker = new Worker(new URL('./example-webworker.js', import.meta.url));

    /**
     * Handle messages from the web worker.
     *
     * @param {MessageEvent} event - Message event from worker
     * @param {Object} event.data - Data received from worker
     */
    worker.onmessage = (event) => {
      console.log('Message received from worker:', event.data);

      // Render the worker response as a paragraph in the component
      this.create('p', { content: JSON.stringify(event.data) });

      /**
       * Emit a dataroom custom event.
       *
       * Other components (or vanilla JS) can listen with:
       *   document.querySelector('example-component')
       *     .addEventListener('WEB-WORKER-RESPONSE', (e) => { ... });
       *
       * Or using dataroom's .on() helper:
       *   element.on('WEB-WORKER-RESPONSE', (data) => { ... });
       */
      this.event('WEB-WORKER-RESPONSE', event.data);
    };

    /**
     * Handle worker errors.
     *
     * Always attach an onerror handler so production issues are visible
     * rather than failing silently.
     */
    worker.onerror = (error) => {
      console.error('Web Worker error:', error);
      this.create('p', { content: `Worker error: ${error.message}` });
      this.event('WEB-WORKER-ERROR', { error: error.message });
    };

    // Store worker reference for external access (useful for testing and debugging)
    this.worker = worker;

    // Send initial message to worker to kick off the demo
    worker.postMessage({ message: 'Hello from the main thread!' });
  }
}

/**
 * Register the custom element.
 *
 * customElements.define() requires a hyphenated name per the Web Components spec.
 * We guard with customElements.get() to prevent errors if the script is loaded
 * multiple times (e.g., during hot module replacement in development).
 */
if (!customElements.get('example-component')) {
  customElements.define('example-component', ExampleComponent);
}
