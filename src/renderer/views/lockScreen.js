// Shown both for the first-ever unlock and whenever auto-lock (or manual
// "Lock now") fires later. The "Quick unlock" button only appears if the
// user has opted into it in Settings -- see security/passphrase.js. The
// "Forgot passphrase?" link only appears if a recovery phrase has been
// set up (also opt-in, same module).

export function renderLockScreen(root, { status, onUnlocked }) {
  renderUnlockForm();

  function renderUnlockForm() {
    root.innerHTML = `
      <div class="centered-screen">
        <div class="card">
          <h1>Locked</h1>
          <p>Enter your passphrase to unlock your data.</p>
          ${
            status.quickUnlockAvailable
              ? '<button id="quick-unlock" type="button">Quick unlock (this device)</button><hr />'
              : ''
          }
          <form id="unlock-form">
            <label>
              Passphrase
              <input type="password" id="passphrase" required autofocus />
            </label>
            <p class="error" id="error" hidden></p>
            <button type="submit">Unlock</button>
          </form>
          ${status.recoveryEnabled ? '<p><button type="button" class="link-button" id="forgot-passphrase">Forgot passphrase?</button></p>' : ''}
        </div>
      </div>
    `;

    const errorEl = root.querySelector('#error');
    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    root.querySelector('#unlock-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      const passphrase = root.querySelector('#passphrase').value;
      try {
        await window.api.vault.unlock(passphrase);
        onUnlocked();
      } catch (err) {
        showError(err.message);
      }
    });

    const quickBtn = root.querySelector('#quick-unlock');
    if (quickBtn) {
      quickBtn.addEventListener('click', async () => {
        errorEl.hidden = true;
        const { ok } = await window.api.vault.quickUnlock();
        if (ok) {
          onUnlocked();
        } else {
          showError('Quick unlock failed. Please enter your passphrase.');
        }
      });
    }

    const forgotBtn = root.querySelector('#forgot-passphrase');
    if (forgotBtn) {
      forgotBtn.addEventListener('click', renderRecoveryForm);
    }
  }

  function renderRecoveryForm() {
    root.innerHTML = `
      <div class="centered-screen">
        <div class="card">
          <h1>Recover with phrase</h1>
          <p>Enter your 6-word recovery phrase, separated by spaces.</p>
          <form id="recovery-form">
            <label>
              Recovery phrase
              <input type="text" id="recovery-words" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus />
            </label>
            <p class="error" id="recovery-error" hidden></p>
            <button type="submit">Unlock</button>
          </form>
          <p><button type="button" class="link-button" id="back-to-unlock">Back to passphrase</button></p>
        </div>
      </div>
    `;

    const errorEl = root.querySelector('#recovery-error');
    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    root.querySelector('#back-to-unlock').addEventListener('click', renderUnlockForm);

    root.querySelector('#recovery-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.hidden = true;

      const words = root.querySelector('#recovery-words').value.trim().split(/\s+/).filter(Boolean);
      if (words.length !== 6) {
        showError('Enter all 6 words, separated by spaces.');
        return;
      }

      try {
        await window.api.vault.recoverWithPhrase(words);
        onUnlocked();
      } catch (err) {
        showError(err.message);
      }
    });
  }
}
