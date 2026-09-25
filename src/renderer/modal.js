// Tiny shared helper for a centered dialog over a dimmed backdrop -- the
// same interaction pattern src/renderer/dueDateSummary.js's due-date
// popup already hand-rolls (close button + backdrop click + Escape),
// pulled out here so new callers don't each reimplement that wiring.
// dueDateSummary.js itself is left as-is (out of scope for this change);
// this is for new call sites only.

import { escapeHtml } from './helpers.js';

// `title` is plain text (escaped here) -- some are user data, like a
// calendar event's title, which can come from an imported .ics file.
export function openModal({ title, wide = false, render }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal${wide ? ' modal-wide' : ''}">
      <h2>${escapeHtml(title)}</h2>
      <div id="modal-body"></div>
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="modal-close-btn">Close</button>
      </div>
    </div>
  `;

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown);
  overlay.querySelector('#modal-close-btn').addEventListener('click', close);

  document.body.appendChild(overlay);
  render(overlay.querySelector('#modal-body'), close);
  return close;
}
