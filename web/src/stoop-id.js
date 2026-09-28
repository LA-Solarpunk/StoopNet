/**
 * Stoop ID Component
 *
 * <stoop-id> — the neighborhood identity card. Asks for a display name and
 * a password, stores the name in localStorage, and stretches the password
 * into a signing key (PBKDF2-SHA256). The signing key is stored locally;
 * the password itself never is. Every message sent through <stoop-chat>
 * ends with a 7-character signature made under that key.
 *
 * Public API (attributes):
 *   username   — reflected; the saved display name (absent when signed out)
 *   signed-in  — reflected; "true" or "false"
 *
 * Events:
 *   identity-changed — detail { username, signatureKey }; emitted whenever
 *   an identity is saved, loaded at startup, or forgotten.
 *
 * For LLMs: the element's attributes are its public API. Other components
 * observe `username` / `signed-in` or listen for `identity-changed`, and
 * the demo page copies the values onto <stoop-chat> via setAttribute().
 */

import DataroomElement from 'dataroom-js';
import {
  SIGNATURE_LENGTH,
  clearIdentity,
  deriveSigningKey,
  loadIdentity,
  randomSalt,
  saveIdentity,
} from './stoop-id-logic.js';

/** Module-level counter so each card gets unique input ids/labels. */
let instanceCount = 0;

/**
 * StoopId
 *
 * Renders a card: a name + password form when signed out, and a "signed in
 * as ..." summary with a Forget button when an identity exists.
 *
 * @extends DataroomElement
 */
class StoopId extends DataroomElement {
  /**
   * Attributes this element observes and reflects.
   *
   * @returns {string[]}
   */
  static get observedAttributes() {
    return ['username', 'signed-in'];
  }

  /**
   * React to external attribute changes by re-rendering the card.
   *
   * @param {string} name Changed attribute name
   * @param {string} oldValue Previous value
   * @param {string} newValue New value
   * @returns {void}
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (!this._initialized || oldValue === newValue) return;
    if (name === 'username' || name === 'signed-in') {
      this.render();
    }
  }

  /**
   * Load any saved identity, reflect it to attributes and render the card.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this._uid = `stoop-id-${instanceCount += 1}`;
    this.identity = loadIdentity();
    this._reflectIdentity();
    this.render();
    if (this.identity) {
      this.event('identity-changed', {
        username: this.identity.username,
        signatureKey: this.identity.key,
      });
    }
  }

  /**
   * Draw the card. Signed-in users see their name and a Forget button;
   * everyone else sees the name + password form.
   *
   * @returns {void}
   */
  render() {
    this.innerHTML = '';

    const card = this.create('section', {
      class: 'stoop-id-card',
      'aria-labelledby': `${this._uid}-title`,
    });
    this.create('h2', {
      id: `${this._uid}-title`,
      class: 'stoop-id-title',
      content: 'Your Stoop ID',
    }, card);

    if (this.identity) {
      const signedIn = this.create('p', { class: 'stoop-id-signed-in' }, card);
      signedIn.append('Signed in as ');
      const name = document.createElement('strong');
      name.textContent = this.identity.username;
      signedIn.append(name, '.');

      this.create('p', {
        class: 'stoop-id-hint',
        content: `Every message you send ends with a ${SIGNATURE_LENGTH}-character ` +
          'signature made from your password — like a wax seal. The password ' +
          'itself is never stored or sent anywhere.',
      }, card);

      const forget = this.create('button', {
        type: 'button',
        class: 'stoop-id-forget',
        content: 'Forget me',
      }, card);
      forget.addEventListener('click', () => this.handleForget());
    } else {
      const form = this.create('form', { class: 'stoop-id-form' }, card);

      this.create('label', {
        for: `${this._uid}-name`,
        content: 'Display name',
      }, form);
      this.nameInput = this.create('input', {
        id: `${this._uid}-name`,
        type: 'text',
        maxlength: '24',
        autocomplete: 'off',
        placeholder: 'How neighbors will see you',
      }, form);

      this.create('label', {
        for: `${this._uid}-password`,
        content: 'Password',
      }, form);
      this.passwordInput = this.create('input', {
        id: `${this._uid}-password`,
        type: 'password',
        autocomplete: 'new-password',
        placeholder: 'Any passphrase you like',
      }, form);

      this.create('p', {
        class: 'stoop-id-hint',
        content: 'Your password is stretched into a signing key and kept in ' +
          'this browser only. It never leaves your device, and it is never ' +
          'used as the message text itself.',
      }, form);

      this.submitButton = this.create('button', {
        type: 'submit',
        class: 'stoop-id-save',
        content: 'Save my ID',
      }, form);

      form.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    this.statusEl = this.create('p', {
      class: 'stoop-id-status',
      role: 'status',
      'aria-live': 'polite',
    }, card);
  }

  /**
   * Create the signing key from the name + password and save the identity.
   *
   * @param {SubmitEvent} event Form submit event
   * @returns {Promise<void>}
   */
  async handleSubmit(event) {
    event.preventDefault();
    const username = this.nameInput.value.trim();
    const password = this.passwordInput.value;

    if (!username) {
      this.setStatus('Pick a display name first.');
      return;
    }
    if (!password) {
      this.setStatus('A password is needed to make your signature.');
      return;
    }

    this.submitButton.disabled = true;
    this.submitButton.textContent = 'Making your signature…';
    try {
      const salt = randomSalt();
      const key = await deriveSigningKey(password, salt);
      this.identity = { username, salt, key };
      saveIdentity(this.identity);
      this._reflectIdentity();
      this.render();
      this.event('identity-changed', { username, signatureKey: key });
      this.setStatus(`Welcome, ${username}! Your messages now carry your ${SIGNATURE_LENGTH}-character signature.`);
    } catch (error) {
      console.error('Stoop ID: key derivation failed', error);
      this.setStatus('Could not create your signing key on this device.');
      if (this.submitButton) {
        this.submitButton.disabled = false;
        this.submitButton.textContent = 'Save my ID';
      }
    }
  }

  /**
   * Remove the stored identity and announce it.
   *
   * @returns {void}
   */
  handleForget() {
    clearIdentity();
    this.identity = null;
    this._reflectIdentity();
    this.render();
    this.event('identity-changed', { username: '', signatureKey: '' });
    this.setStatus('ID forgotten. Pick a new name and password any time.');
  }

  /**
   * Mirror the current identity into the element's public attributes.
   *
   * @returns {void}
   */
  _reflectIdentity() {
    if (this.identity) {
      this.setAttribute('username', this.identity.username);
      this.setAttribute('signed-in', 'true');
    } else {
      this.setAttribute('signed-in', 'false');
      this.removeAttribute('username');
    }
  }

  /**
   * Show a status message in the card's live region.
   *
   * @param {string} text Message to announce
   * @returns {void}
   */
  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }
}

// Register the custom element (guard against double-definition on HMR)
if (!customElements.get('stoop-id')) {
  customElements.define('stoop-id', StoopId);
}
