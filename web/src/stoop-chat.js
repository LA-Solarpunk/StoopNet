/**
 * Stoop Chat Component
 *
 * <stoop-chat> — the neighborhood chat interface, ported from the Stoop
 * node's captive-portal pages. Shows the #channel message stream, a search
 * box, and a composer that signs every outgoing message: a 7-character
 * hex signature derived from the user's password (see <stoop-id>) is
 * appended to the end of each message.
 *
 * Public API (attributes):
 *   username      — who is sending; falls back to localStorage
 *                   ("stoop_username") when absent
 *   signature-key — hex signing key used to sign messages; falls back to
 *                   localStorage ("stoop_signature_key") when absent
 *   channel       — channel name shown in the header and used in API paths
 *                   (default: "stoop")
 *   demo          — presence: run offline (no radio polling); sent messages
 *                   are signed and kept in the page so the signature flow
 *                   can be demonstrated without a Stoop node
 *
 * For LLMs: data flows in through attributes. The chat never reaches into
 * <stoop-id>; the page wires them by setting these attributes.
 */

import DataroomElement from 'dataroom-js';
import {
  SIGNATURE_LENGTH,
  signMessage,
  readSignatureKey,
  readUsername,
  STORAGE_KEYS,
} from './stoop-id-logic.js';
import {
  DEFAULT_CHANNEL,
  appendSignature,
  filterMessages,
  formatTime,
  parseMaxMessageBytes,
  remainingCharacters,
  splitSender,
  splitSignature,
  utf8Length,
} from './stoop-chat-logic.js';

/** How often the message list and rate limits are refreshed. */
const POLL_MS = 3000;

/** Conservative message size guess until the node reports the real one. */
const DEFAULT_MAX_POST_BYTES = 128;

/** Module-level counter for unique element ids inside each chat. */
let instanceCount = 0;

/**
 * StoopChat
 *
 * @extends DataroomElement
 */
class StoopChat extends DataroomElement {
  /**
   * Attributes this element observes.
   *
   * @returns {string[]}
   */
  static get observedAttributes() {
    return ['username', 'signature-key', 'channel'];
  }

  /**
   * React to attribute changes from outside (the wiring pattern).
   *
   * @param {string} name Changed attribute name
   * @param {string} oldValue Previous value
   * @param {string} newValue New value
   * @returns {void}
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (!this._initialized || oldValue === newValue) return;
    if (name === 'username' || name === 'signature-key') {
      this.syncIdentity();
    } else if (name === 'channel' && this.channelEl) {
      this.channelEl.textContent = `#${this.channel}`;
      this.updateCharCount();
    }
  }

  /** Channel name from the `channel` attribute. */
  get channel() {
    return this.getAttribute('channel') || DEFAULT_CHANNEL;
  }

  /**
   * Build the chat skeleton, adopt any identity, and start polling (or
   * seed the offline demo).
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this._uid = `stoop-chat-${instanceCount += 1}`;
    this.demoMode = this.hasAttribute('demo');
    this.allMessages = [];
    this.maxPostBytes = DEFAULT_MAX_POST_BYTES;
    this.budgetOk = false; // fail closed until /api/limits says otherwise
    this.waitMs = 0;

    this.render();
    this.syncIdentity();

    if (this.demoMode) {
      this.seedDemoMessages();
      if (this.statusEl) {
        this.statusEl.textContent =
          'Demo mode — no radio connected. Messages stay in this browser.';
      }
      this.updateSendability();
    } else {
      this.refresh();
      this.refreshLimits();
      this.loadMaxLength();
      this._pollTimer = setInterval(() => {
        this.refresh();
        this.refreshLimits();
      }, POLL_MS);
    }
  }

  /**
   * Draw the full chat: header with whoami, search bar, message list,
   * status line and the composer.
   *
   * @returns {void}
   */
  render() {
    this.innerHTML = '';

    const root = this.create('section', {
      class: 'stoop-chat',
      'aria-label': 'Stoop chat',
    });

    const header = this.create('header', { class: 'stoop-chat-header' }, root);
    this.channelEl = this.create('h2', {
      class: 'stoop-chat-channel',
      content: `#${this.channel}`,
    }, header);
    this.whoamiEl = this.create('p', {
      class: 'stoop-chat-whoami',
      'aria-live': 'polite',
    }, header);

    const searchBar = this.create('div', { class: 'stoop-chat-search' }, root);
    this.create('label', {
      for: `${this._uid}-search`,
      class: 'stoop-chat-sr-only',
      content: 'Search messages',
    }, searchBar);
    this.searchInput = this.create('input', {
      id: `${this._uid}-search`,
      type: 'search',
      placeholder: 'Search messages…',
      autocomplete: 'off',
      'aria-label': 'Search messages',
    }, searchBar);
    this.searchInput.addEventListener('input', () => this.renderMessages());

    this.messagesEl = this.create('div', {
      class: 'stoop-chat-messages',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Messages',
    }, root);

    this.statusEl = this.create('p', {
      class: 'stoop-chat-status',
      role: 'status',
      'aria-live': 'polite',
    }, root);

    const form = this.create('form', { class: 'stoop-chat-composer' }, root);
    this.create('label', {
      for: `${this._uid}-text`,
      class: 'stoop-chat-sr-only',
      content: `Message #${this.channel}`,
    }, form);
    this.input = this.create('input', {
      id: `${this._uid}-text`,
      type: 'text',
      maxlength: '150',
      autocomplete: 'off',
    }, form);
    this.sendButton = this.create('button', {
      type: 'submit',
      class: 'stoop-chat-send',
      content: 'Send',
    }, form);
    this.charCountEl = this.create('span', {
      class: 'stoop-chat-count',
      'aria-hidden': 'true',
    }, form);

    form.addEventListener('submit', (e) => this.handleSubmit(e));
    this.input.addEventListener('input', () => this.updateCharCount());
  }

  /**
   * Adopt the identity from attributes (preferred) or localStorage
   * (fallback), then update the whoami line and composer state.
   *
   * @returns {void}
   */
  syncIdentity() {
    const attrName = this.getAttribute('username');
    this._username = (attrName !== null && attrName !== ''
      ? attrName
      : readUsername()).trim();
    this._signatureKey = this.getAttribute('signature-key')
      || readSignatureKey();

    if (this.whoamiEl) {
      this.whoamiEl.innerHTML = '';
      if (this._username) {
        this.whoamiEl.append('You are ');
        const name = document.createElement('strong');
        name.textContent = this._username;
        this.whoamiEl.append(name);
        if (this._signatureKey) {
          this.whoamiEl.append(` — your messages end with a ${SIGNATURE_LENGTH}-character signature.`);
        }
      } else {
        this.whoamiEl.textContent =
          'Pick a name in the Stoop ID card to start chatting.';
      }
    }
    this.updateSendability();
    this.updateCharCount();
  }

  /**
   * Seed a couple of sample messages for the offline demo, one of them
   * already signed so the signature styling is visible.
   *
   * @returns {void}
   */
  seedDemoMessages() {
    const now = Math.floor(Date.now() / 1000);
    this.allMessages = [
      {
        text: 'ada: Porch sale Saturday morning — lemonade on the corner! #dec0de5',
        ts: now - 600,
      },
      { text: 'sam: Anyone have a spare phone charger?', ts: now - 300 },
    ];
    this.renderMessages();
  }

  /**
   * Redraw the message list from allMessages, honoring the search query,
   * and scroll to the newest message.
   *
   * @returns {void}
   */
  renderMessages() {
    if (!this.messagesEl) return;
    const query = this.searchInput ? this.searchInput.value : '';
    const list = filterMessages(this.allMessages, query);
    this.messagesEl.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'stoop-chat-empty';
      empty.textContent = query.trim()
        ? 'No messages match your search.'
        : 'No messages yet. Be the first to say hello.';
      this.messagesEl.appendChild(empty);
      return;
    }

    for (const m of list) {
      const { sender, body } = splitSender(m.text);
      const { body: text, signature } = splitSignature(body);

      const card = document.createElement('article');
      card.className = 'stoop-chat-msg';
      if (sender) {
        const senderEl = document.createElement('span');
        senderEl.className = 'stoop-chat-sender';
        senderEl.textContent = sender;
        card.appendChild(senderEl);
      }
      card.appendChild(document.createTextNode(text));
      if (signature) {
        const sigEl = document.createElement('span');
        sigEl.className = 'stoop-chat-signature';
        sigEl.title = 'Signature made from the sender\u2019s password';
        sigEl.textContent = ` #${signature}`;
        card.appendChild(sigEl);
      }
      const time = formatTime(m.ts);
      if (time) {
        const timeEl = document.createElement('span');
        timeEl.className = 'stoop-chat-time';
        timeEl.textContent = time;
        card.appendChild(timeEl);
      }
      this.messagesEl.appendChild(card);
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /**
   * Enable or disable the composer, and explain why it is disabled.
   * Mirrors the node's captive-portal behavior: sending stays disabled
   * until both a username and a known-good rate budget exist.
   *
   * @returns {void}
   */
  updateSendability() {
    if (!this.sendButton) return;
    const allowed = this.demoMode
      ? Boolean(this._username)
      : Boolean(this._username) && this.budgetOk;
    this.sendButton.disabled = !allowed;
    this.input.disabled = !this._username;
    this.input.placeholder = this._username
      ? `Message #${this.channel}…`
      : 'Pick a name in the Stoop ID card first';
  }

  /**
   * Show how many characters are still available in the composer, counting
   * UTF-8 bytes (what the node enforces) and reserving room for the
   * signature that will be appended on send.
   *
   * @returns {void}
   */
  updateCharCount() {
    if (!this.charCountEl) return;
    const remaining = remainingCharacters(
      this.input.value,
      this.maxPostBytes,
      Boolean(this._signatureKey)
    );
    this.charCountEl.textContent =
      `${remaining} character${remaining === 1 ? '' : 's'} left`;
    this.charCountEl.classList.toggle('stoop-chat-count-low', remaining <= 20);
  }

  /**
   * Ask the node to sign... er, sign the draft with the local signing key
   * and hand the message to the radio. In demo mode the signed message is
   * kept in the page instead.
   *
   * @param {SubmitEvent} event Form submit event
   * @returns {Promise<void>}
   */
  async handleSubmit(event) {
    event.preventDefault();
    const text = this.input.value.trim();
    if (!text || this.sendButton.disabled) return;

    this.sendButton.disabled = true;
    try {
      let body = text;
      if (this._username && this._signatureKey) {
        try {
          const signature = await signMessage(this._signatureKey, text);
          body = appendSignature(text, signature);
        } catch (error) {
          console.error('Stoop chat: signing failed', error);
          if (this.statusEl) {
            this.statusEl.textContent =
              'Could not sign this message — sending it unsigned.';
          }
        }
      }

      if (utf8Length(body) > this.maxPostBytes) {
        if (this.statusEl) {
          this.statusEl.textContent =
            `Message is too long (max ${this.maxPostBytes} characters).`;
        }
        return;
      }

      if (this.demoMode) {
        this.allMessages.push({
          text: `${this._username}: ${body}`,
          ts: Math.floor(Date.now() / 1000),
        });
        this.input.value = '';
        this.updateCharCount();
        this.renderMessages();
        return;
      }

      const res = await this.apiFetch('/api/post', {
        method: 'POST',
        body: new URLSearchParams({ username: this._username, text: body }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 429 && data) {
        this.applyLimits(data); // disables the button and shows the wait
        return;
      }
      if (!res.ok) throw new Error('send failed');

      if (data) this.applyLimits(data);
      this.input.value = '';
      this.updateCharCount();
      await this.refresh();
    } catch (error) {
      if (this.statusEl) {
        this.statusEl.textContent = 'Message failed to send. Try again.';
      }
    } finally {
      this.updateSendability();
      this.updateCharCount();
      this.input.focus();
    }
  }

  /**
   * Fetch the channel's messages and redraw. On failure, say so in the
   * status line without wiping the last-known messages.
   *
   * @returns {Promise<void>}
   */
  async refresh() {
    try {
      const res = await fetch(`/api/${encodeURIComponent(this.channel)}/messages`);
      if (!res.ok) throw new Error('bad response');
      this.allMessages = await res.json();
      this.renderMessages();
      if (this.statusEl && this.statusEl.textContent.startsWith("Can't reach")) {
        this.statusEl.textContent = '';
      }
    } catch (error) {
      if (this.statusEl) {
        this.statusEl.textContent = "Can't reach the radio right now.";
      }
    }
  }

  /**
   * Poll the node's rate-limit budget. Until a budget is confirmed the
   * composer stays disabled (fail closed).
   *
   * @returns {Promise<void>}
   */
  async refreshLimits() {
    try {
      const res = await this.apiFetch('/api/limits');
      if (!res.ok) return;
      this.applyLimits(await res.json());
    } catch (error) {
      // leave last-known limits in place; message polling surfaces issues
    }
  }

  /**
   * Merge a /api/limits (or 429) payload into local state.
   *
   * @param {{max_post_bytes?: number, tokens_remaining?: number,
   *          node_tokens_remaining?: number, next_token_ms?: number}} data
   * @returns {void}
   */
  applyLimits(data) {
    if (data.max_post_bytes) this.maxPostBytes = data.max_post_bytes;
    this.budgetOk = data.tokens_remaining > 0 && data.node_tokens_remaining > 0;
    this.waitMs = data.next_token_ms || 0;
    this.updateSendability();
    this.updateCharCount();
    if (!this.budgetOk && this.statusEl && !this.demoMode) {
      const secs = Math.ceil(this.waitMs / 1000);
      this.statusEl.textContent =
        `Sending is paused — try again in ${secs}s.`;
    }
  }

  /**
   * Learn the real maximum message size so the counter is honest from the
   * first keystroke. The server enforces the real value regardless.
   *
   * @returns {Promise<void>}
   */
  async loadMaxLength() {
    try {
      const res = await fetch(
        `/api/${encodeURIComponent(this.channel)}/max_message_bytes`
      );
      if (!res.ok) return;
      const n = parseMaxMessageBytes(await res.text());
      if (n) {
        this.maxPostBytes = n;
        this.updateCharCount();
      }
    } catch (error) {
      // keep the guessed default
    }
  }

  /**
   * Wrap fetch to attach the session-token header and adopt whatever token
   * the node hands back — the node may issue or re-confirm one on every
   * response. (dataroom's getJSON/call don't support this handshake.)
   *
   * @param {string} path API path
   * @param {RequestInit} [opts] Fetch options
   * @returns {Promise<Response>}
   */
  async apiFetch(path, opts = {}) {
    opts.headers = Object.assign({}, opts.headers, {
      'X-Stoop-Session': localStorage.getItem(STORAGE_KEYS.SESSION) || '',
    });
    const res = await fetch(path, opts);
    const token = res.headers.get('X-Stoop-Session');
    if (token) localStorage.setItem(STORAGE_KEYS.SESSION, token);
    return res;
  }

  /**
   * Stop polling when the element is removed from the DOM.
   *
   * @returns {void}
   */
  disconnect() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}

// Register the custom element (guard against double-definition on HMR)
if (!customElements.get('stoop-chat')) {
  customElements.define('stoop-chat', StoopChat);
}
