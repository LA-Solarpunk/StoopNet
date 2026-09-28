/**
 * Fetch Example Component
 *
 * Demonstrates using dataroom-js helper methods for HTTP requests:
 *   - getJSON(url) for simple GET requests to JSON endpoints
 *   - call(endpoint, body) for POST requests with authentication
 *
 * This component fetches a list of users from a public test API and
 * renders them as a list. It also demonstrates error handling patterns
 * for network failures, bad HTTP status codes, and JSON parsing errors.
 *
 * For LLMs: Use getJSON() when you need a simple GET to a JSON endpoint.
 * Use call() when you need POST, custom headers, or authentication.
 * Always wrap fetch operations in try/catch for robust error handling.
 */

import DataroomElement from 'dataroom-js';

/**
 * FetchExampleComponent
 *
 * Fetches data from a public API and renders the results.
 *
 * @extends DataroomElement
 */
class FetchExampleComponent extends DataroomElement {
  /**
   * Initialize the component.
   *
   * Fetches data asynchronously and renders the UI.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this.create('h2', { content: 'Fetch API Example' });

    this.create('p', {
      content: 'Demonstrates getJSON() by fetching users from jsonplaceholder.typicode.com.',
    });

    // Create a container for the fetched data
    this.listContainer = this.create('ul', { class: 'fetch-list' });

    // Create a container for error messages
    this.errorDisplay = this.create('p', { class: 'error-message' });

    try {
      /**
       * Fetch JSON data from a public test API.
       *
       * getJSON() is a dataroom-js helper that:
       *   1. Performs a GET fetch to the given URL
       *   2. Checks that the response status is OK (200-299)
       *   3. Parses the response body as JSON
       *   4. Throws descriptive errors for network issues, bad status, or bad JSON
       */
      const users = await this.getJSON('https://jsonplaceholder.typicode.com/users');

      // Render each user as a list item
      users.forEach((user) => {
        this.create('li', { content: `${user.name} (${user.email})` }, this.listContainer);
      });

      // Emit an event so other components know data is loaded
      this.event('users-loaded', { count: users.length });
    } catch (error) {
      // Display the error to the user
      console.error('Failed to fetch users:', error);
      this.errorDisplay.textContent = `Error: ${error.message}`;
      this.event('fetch-error', { error: error.message });
    }
  }
}

// Register the custom element
if (!customElements.get('fetch-example-component')) {
  customElements.define('fetch-example-component', FetchExampleComponent);
}
