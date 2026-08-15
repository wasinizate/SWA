// Small shared modal for entering a passphrase before exporting (or
// decrypting an import) -- same .modal-overlay/.modal pattern already
// used for the calendar event form (calendar.js) and the due-date
// digest (dueDateSummary.js), just a single password field instead of a
// whole form. Returns a Promise resolving to the entered string, or
// null if cancelled.

import { escapeHtml } from './helpers.js';

export function promptForPassphrase({ title, confirmLabel = 'Continue', helpText = '' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${escapeHtml(title)}</h2>
        ${helpText ? `<p class="hint">${escapeHtml(helpText)}</p>` : ''}
        <form id="passphrase-form">
          <label>Passphrase <input type="password" id="passphrase-input" required /></label>
          <div class="form-actions">
            <button type="submit">${escapeHtml(confirmLabel)}</button>
            <button type="button" class="btn-secondary" id="passphrase-cancel">Cancel</button>
          </div>
        </form>
      </div>
    `;

    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') close(null);
    }
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKeydown);

    overlay.querySelector('#passphrase-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#passphrase-form').addEventListener('submit', (event) => {
      event.preventDefault();
      close(overlay.querySelector('#passphrase-input').value);
    });

    document.body.appendChild(overlay);
    overlay.querySelector('#passphrase-input').focus();
  });
}
