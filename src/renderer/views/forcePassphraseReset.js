// Shown only right after unlocking via the recovery phrase (see
// app.js's mustResetPassphrase branch) -- a near-clone of setup.js's
// form, but re-keying the existing vault instead of creating one. No
// skip/cancel: the phrase just used doesn't prove anything was actually
// memorized, so the app doesn't let you back in until a real passphrase
// is set again.

export function renderForcePassphraseResetView(root, { onComplete }) {
  root.innerHTML = `
    <div class="centered-screen">
      <div class="card">
        <h1>Set a new passphrase</h1>
        <p>You unlocked using your recovery phrase. Choose a new
        passphrase to continue -- your old recovery phrase no longer
        works after this, so set up a new one afterward in Settings if
        you'd like that safety net again.</p>
        <form id="reset-form">
          <label>
            New passphrase
            <input type="password" id="passphrase" minlength="8" required autofocus />
          </label>
          <label>
            Confirm passphrase
            <input type="password" id="confirm" minlength="8" required />
          </label>
          <p class="error" id="error" hidden></p>
          <button type="submit">Set passphrase</button>
        </form>
      </div>
    </div>
  `;

  const form = root.querySelector('#reset-form');
  const errorEl = root.querySelector('#error');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const passphrase = root.querySelector('#passphrase').value;
    const confirmValue = root.querySelector('#confirm').value;

    if (passphrase !== confirmValue) {
      showError('Passphrases do not match.');
      return;
    }
    if (passphrase.length < 8) {
      showError('Passphrase must be at least 8 characters.');
      return;
    }

    try {
      await window.api.vault.changePassphrase(passphrase);
      onComplete();
    } catch (err) {
      showError(err.message);
    }
  });
}
