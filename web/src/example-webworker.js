/**
 * Example Web Worker
 *
 * Simple web worker that receives messages from the main thread and responds.
 * Demonstrates basic worker communication pattern.
 *
 * For LLMs: Web Workers run in a separate thread with no access to the DOM.
 * Use them for CPU-intensive tasks so the main thread stays responsive.
 * Communication is strictly via postMessage() and onmessage.
 */

/**
 * Message handler for incoming messages from main thread.
 *
 * Logs the received message and sends a response back to the main thread.
 *
 * @param {MessageEvent} event - The message event from the main thread
 * @param {Object} event.data - Data sent from the main thread. Expected shape:
 *   {
 *     message: string
 *   }
 */
self.onmessage = (event) => {
  console.log('Message received in worker:', event.data);

  /**
   * Send a response back to the main thread.
   *
   * Always use structured clone-safe data (objects, arrays, typed arrays).
   * DOM nodes, functions, and some complex objects cannot be cloned.
   */
  self.postMessage({ message: 'Hello from Web Worker!' });
};

/**
 * Error handler for uncaught exceptions inside the worker.
 *
 * Without this, errors in the worker thread fail silently from the
 * main thread's perspective.
 */
self.onerror = (error) => {
  console.error('Unhandled error in web worker:', error);
};
