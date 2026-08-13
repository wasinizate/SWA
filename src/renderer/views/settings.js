// Settings: auto-lock timeout, order due-date desktop reminders, the
// opt-in quick-unlock toggle, and changing the vault passphrase.

export function renderSettingsView(container) {
  container.innerHTML = `
    <h1>Settings</h1>

    <section class="card">
      <h2>Auto-lock</h2>
      <label>
        Lock after inactivity (minutes)
        <input type="number" id="timeout-minutes" min="1" max="180" />
      </label>
      <button id="save-timeout" type="button">Save</button>
      <p class="hint" id="timeout-saved" hidden>Saved.</p>
    </section>

    <section class="card">
      <h2>Order due date reminders</h2>
      <p class="hint">
        Shows a desktop popup for orders with an upcoming delivery due
        date -- see the Calendar tab, where due dates appear
        automatically once set on an order.
      </p>
      <label class="checkbox-label">
        <input type="checkbox" id="order-reminder-enabled" /> Enable order due date reminders
      </label>
      <label>
        Remind me this many days before the due date
        <input type="number" id="order-reminder-days-before" min="0" max="30" />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="show-due-summary" /> Show a due-date summary when opening the app
      </label>
      <button id="save-order-reminder" type="button">Save</button>
      <p class="hint" id="order-reminder-saved" hidden>Saved.</p>
    </section>

    <section class="card">
      <h2>Quick unlock</h2>
      <p class="hint">
        When enabled, your passphrase is wrapped using this operating
        system's secure storage (Keychain / Credential Manager / libsecret)
        so you can unlock without retyping it. Read the README's threat
        model before enabling this on a shared or untrusted computer --
        it means anyone who can act as your current OS user could unlock
        the vault too.
      </p>
      <label class="checkbox-label">
        <input type="checkbox" id="quick-unlock-toggle" /> Enable quick unlock
      </label>
      <div id="quick-unlock-confirm" hidden>
        <label>Confirm current passphrase <input type="password" id="confirm-passphrase" /></label>
        <button id="confirm-quick-unlock" type="button">Confirm</button>
      </div>
      <p class="error" id="qu-error" hidden></p>
    </section>

    <section class="card">
      <h2>Change passphrase</h2>
      <form id="change-form">
        <label>New passphrase <input type="password" id="new-passphrase" minlength="8" required /></label>
        <label>Confirm <input type="password" id="confirm-new-passphrase" minlength="8" required /></label>
        <button type="submit">Change passphrase</button>
      </form>
      <p class="error" id="change-error" hidden></p>
      <p class="hint" id="change-saved" hidden>Passphrase changed.</p>
    </section>
  `;

  init();

  async function init() {
    const [timeoutSeconds, status, orderReminderConfig] = await Promise.all([
      window.api.vault.getIdleTimeoutSeconds(),
      window.api.vault.status(),
      window.api.settings.getOrderDueReminderConfig(),
    ]);
    container.querySelector('#timeout-minutes').value = Math.round((timeoutSeconds ?? 600) / 60);
    container.querySelector('#quick-unlock-toggle').checked = status.quickUnlockEnabled;

    container.querySelector('#order-reminder-enabled').checked = orderReminderConfig?.enabled ?? true;
    container.querySelector('#order-reminder-days-before').value = orderReminderConfig?.daysBefore ?? 1;
    container.querySelector('#show-due-summary').checked = orderReminderConfig?.showSummaryOnOpen ?? true;
  }

  container.querySelector('#save-timeout').addEventListener('click', async () => {
    const minutes = Number(container.querySelector('#timeout-minutes').value) || 10;
    await window.api.vault.setIdleTimeoutSeconds(minutes * 60);
    flash(container.querySelector('#timeout-saved'));
  });

  container.querySelector('#save-order-reminder').addEventListener('click', async () => {
    const enabled = container.querySelector('#order-reminder-enabled').checked;
    const daysBefore = Number(container.querySelector('#order-reminder-days-before').value) || 0;
    const showSummaryOnOpen = container.querySelector('#show-due-summary').checked;
    await window.api.settings.setOrderDueReminderConfig(enabled, daysBefore, showSummaryOnOpen);
    flash(container.querySelector('#order-reminder-saved'));
  });

  const toggle = container.querySelector('#quick-unlock-toggle');
  const confirmBox = container.querySelector('#quick-unlock-confirm');
  const quError = container.querySelector('#qu-error');

  toggle.addEventListener('change', async () => {
    quError.hidden = true;
    if (toggle.checked) {
      // We need the plaintext passphrase once more to wrap it with
      // safeStorage -- it's never persisted anywhere until this point.
      confirmBox.hidden = false;
    } else {
      await window.api.vault.setQuickUnlock(false);
      confirmBox.hidden = true;
    }
  });

  container.querySelector('#confirm-quick-unlock').addEventListener('click', async () => {
    const pass = container.querySelector('#confirm-passphrase').value;
    try {
      await window.api.vault.setQuickUnlock(true, pass);
      confirmBox.hidden = true;
    } catch (err) {
      quError.textContent = err.message;
      quError.hidden = false;
      toggle.checked = false;
    }
  });

  container.querySelector('#change-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = container.querySelector('#change-error');
    errorEl.hidden = true;

    const next = container.querySelector('#new-passphrase').value;
    const confirm = container.querySelector('#confirm-new-passphrase').value;
    if (next !== confirm) {
      errorEl.textContent = 'Passphrases do not match.';
      errorEl.hidden = false;
      return;
    }

    try {
      await window.api.vault.changePassphrase(next);
      container.querySelector('#change-form').reset();
      flash(container.querySelector('#change-saved'));
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  function flash(el) {
    el.hidden = false;
    setTimeout(() => {
      el.hidden = true;
    }, 1500);
  }
}
