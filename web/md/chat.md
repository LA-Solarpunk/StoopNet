---
title: Stoop Chat Demo
type: chat
---
# Stoop Chat

This demo pairs the two Stoop Net components:

- **`<stoop-id>`** — asks for your display name and a password. The name is
  kept in local storage; the password is stretched into a signing key that
  never leaves your device.
- **`<stoop-chat>`** — the neighborhood chat. Every message you send ends
  with a **7-character signature** derived from your password, like a wax
  seal: `Hello neighbors! #3f9a2c1`.

This page runs in demo mode (the `demo` attribute), so messages stay in the
browser and no radio is needed. Point a real Stoop node at this page by
removing the attribute — the chat then talks to `/api/*` on the node.

Set your ID, then say hello:

<div class="stoop-demo">
  <stoop-id id="demo_identity"></stoop-id>
  <stoop-chat id="demo_chat" demo></stoop-chat>
</div>

<script>
  (function () {
    function wire() {
      var identity = document.getElementById('demo_identity');
      var chat = document.getElementById('demo_chat');
      if (!identity || !chat) return;
      // The wiring pattern: copy identity data onto the chat element by
      // setting its attributes — components never reach into each other.
      identity.addEventListener('identity-changed', function (e) {
        var d = e.detail || {};
        if (d.username) { chat.setAttribute('username', d.username); }
        else { chat.removeAttribute('username'); }
        if (d.signatureKey) { chat.setAttribute('signature-key', d.signatureKey); }
        else { chat.removeAttribute('signature-key'); }
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire);
    } else {
      wire();
    }
  })();
</script>
