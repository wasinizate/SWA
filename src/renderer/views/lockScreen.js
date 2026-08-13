// Shown both for the first-ever unlock and whenever auto-lock (or manual
// "Lock now") fires later. The "Quick unlock" button only appears if the
// user has opted into it in Settings -- see security/passphrase.js.

export function renderLockScreen(root, { status, onUnlocked }) {
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
}
