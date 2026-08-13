// First-launch screen: choose the passphrase that will encrypt the
// database. There is no "forgot passphrase" flow anywhere in this
// app -- see the README threat model for why that's a deliberate trade-off.

export function renderSetupView(root, { onComplete }) {
  root.innerHTML = `
    <div class="centered-screen">
      <div class="card">
        <h1>Welcome</h1>
        <p>Choose a passphrase to encrypt your local database. There is
        no password reset: if you lose this passphrase, your data cannot
        be recovered.</p>
        <form id="setup-form">
          <label>
            Passphrase
            <input type="password" id="passphrase" minlength="8" required autofocus />
          </label>
          <label>
            Confirm passphrase
            <input type="password" id="confirm" minlength="8" required />
          </label>
          <p class="error" id="error" hidden></p>
          <button type="submit">Create vault</button>
        </form>
      </div>
    </div>
  `;

  const form = root.querySelector('#setup-form');
  const errorEl = root.querySelector('#error');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const passphrase = root.querySelector('#passphrase').value;
    const confirm = root.querySelector('#confirm').value;

    if (passphrase !== confirm) {
      showError('Passphrases do not match.');
      return;
    }
    if (passphrase.length < 8) {
      showError('Passphrase must be at least 8 characters.');
      return;
    }

    try {
      await window.api.vault.setup(passphrase);
      onComplete();
    } catch (err) {
      showError(err.message);
    }
  });
}
