// Settings: auto-lock timeout, order due-date desktop reminders, the
// opt-in quick-unlock toggle, appearance (theme), and changing the vault
// passphrase.

import { escapeHtml, loadingHtml } from '../helpers.js';
import { THEMES, applyTheme, getCurrentTheme } from '../theme.js';
import { showToast } from '../toast.js';
import { renderImportPanel } from '../importPanel.js';

// Accepts { navigate } for signature consistency with every other view
// (shell.js always passes it) -- not currently used here since this
// page has no navigation of its own.
export function renderSettingsView(container, { navigate } = {}) {
  container.innerHTML = `
    <h1>Settings</h1>

    <section class="card">
      <h2>Appearance</h2>
      <p class="hint">Changes apply immediately.</p>
      <div class="theme-swatches" id="theme-swatches">
        ${THEMES.map(
          (t) => `
          <button type="button" class="theme-swatch" data-theme-id="${t.id}" title="${escapeHtml(t.label)}">
            <span class="theme-swatch-preview" style="background: linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%);"></span>
            <span class="theme-swatch-label">${escapeHtml(t.label)}</span>
          </button>`
        ).join('')}
      </div>
    </section>

    <section class="card">
      <h2>Auto-lock</h2>
      <div id="auto-lock-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Order due date reminders</h2>
      <p class="hint">
        Shows a desktop popup for orders with an upcoming delivery due
        date -- see the Calendar tab, where due dates appear
        automatically once set on an order.
      </p>
      <div id="order-reminder-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Updates</h2>
      <p class="hint">
        Manual only -- this app never checks for updates on its own.
        Clicking below sends a single request to GitHub to compare
        version numbers; nothing else is sent, and nothing happens
        automatically or in the background.
      </p>
      <button id="check-updates" type="button" class="btn-secondary">Check for updates</button>
      <p class="hint" id="update-result"></p>
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
      <div id="quick-unlock-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Import</h2>
      <div id="import-panel-body"></div>
    </section>

    <section class="card">
      <h2>Change passphrase</h2>
      <form id="change-form">
        <label>New passphrase <input type="password" id="new-passphrase" minlength="8" required /></label>
        <label>Confirm <input type="password" id="confirm-new-passphrase" minlength="8" required /></label>
        <button type="submit">Change passphrase</button>
      </form>
      <p class="error" id="change-error" hidden></p>
    </section>
  `;

  init();

  // Auto-lock/Order-reminders/Quick-unlock all show a loading placeholder
  // (see the template above) until their data actually arrives, rather
  // than painting default/unchecked values and visibly flipping them a
  // moment later once init()'s Promise.all resolves -- each section's
  // real controls are only ever built once its data is in hand.
  async function init() {
    const [timeoutSeconds, status, orderReminderConfig] = await Promise.all([
      window.api.vault.getIdleTimeoutSeconds(),
      window.api.vault.status(),
      window.api.settings.getOrderDueReminderConfig(),
    ]);

    renderAutoLock(timeoutSeconds);
    renderOrderReminder(orderReminderConfig);
    renderQuickUnlock(status.quickUnlockEnabled);
    renderImportPanel(container.querySelector('#import-panel-body'));

    // Already applied to the page by shell.js at boot -- this just marks
    // which swatch matches what's currently live, no extra IPC call.
    markActiveSwatch(getCurrentTheme());
  }

  function renderAutoLock(timeoutSeconds) {
    const body = container.querySelector('#auto-lock-body');
    body.innerHTML = `
      <label>
        Lock after inactivity (minutes)
        <input type="number" id="timeout-minutes" min="1" max="180" value="${Math.round((timeoutSeconds ?? 600) / 60)}" />
      </label>
      <button id="save-timeout" type="button">Save</button>
    `;
    body.querySelector('#save-timeout').addEventListener('click', async () => {
      const minutes = Number(body.querySelector('#timeout-minutes').value) || 10;
      await window.api.vault.setIdleTimeoutSeconds(minutes * 60);
      showToast('Saved.');
    });
  }

  function renderOrderReminder(orderReminderConfig) {
    const body = container.querySelector('#order-reminder-body');
    const enabled = orderReminderConfig?.enabled ?? true;
    const daysBefore = orderReminderConfig?.daysBefore ?? 1;
    const showSummaryOnOpen = orderReminderConfig?.showSummaryOnOpen ?? true;

    body.innerHTML = `
      <label class="checkbox-label">
        <input type="checkbox" id="order-reminder-enabled" ${enabled ? 'checked' : ''} /> Enable order due date reminders
      </label>
      <label>
        Remind me this many days before the due date
        <input type="number" id="order-reminder-days-before" min="0" max="30" value="${daysBefore}" />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="show-due-summary" ${showSummaryOnOpen ? 'checked' : ''} /> Show a due-date summary when opening the app
      </label>
      <button id="save-order-reminder" type="button">Save</button>
    `;
    body.querySelector('#save-order-reminder').addEventListener('click', async () => {
      const isEnabled = body.querySelector('#order-reminder-enabled').checked;
      const days = Number(body.querySelector('#order-reminder-days-before').value) || 0;
      const showSummary = body.querySelector('#show-due-summary').checked;
      await window.api.settings.setOrderDueReminderConfig(isEnabled, days, showSummary);
      showToast('Saved.');
    });
  }

  function renderQuickUnlock(quickUnlockEnabled) {
    const body = container.querySelector('#quick-unlock-body');
    body.innerHTML = `
      <label class="checkbox-label">
        <input type="checkbox" id="quick-unlock-toggle" ${quickUnlockEnabled ? 'checked' : ''} /> Enable quick unlock
      </label>
      <div id="quick-unlock-confirm" hidden>
        <label>Confirm current passphrase <input type="password" id="confirm-passphrase" /></label>
        <button id="confirm-quick-unlock" type="button">Confirm</button>
      </div>
      <p class="error" id="qu-error" hidden></p>
    `;

    const toggle = body.querySelector('#quick-unlock-toggle');
    const confirmBox = body.querySelector('#quick-unlock-confirm');
    const quError = body.querySelector('#qu-error');

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

    body.querySelector('#confirm-quick-unlock').addEventListener('click', async () => {
      const pass = body.querySelector('#confirm-passphrase').value;
      try {
        await window.api.vault.setQuickUnlock(true, pass);
        confirmBox.hidden = true;
      } catch (err) {
        quError.textContent = err.message;
        quError.hidden = false;
        toggle.checked = false;
      }
    });
  }

  function markActiveSwatch(themeId) {
    container.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeId === themeId);
    });
  }

  container.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const themeId = btn.dataset.themeId;
      applyTheme(themeId); // instant preview
      markActiveSwatch(themeId);
      await window.api.settings.setTheme(themeId);
    });
  });

  container.querySelector('#check-updates').addEventListener('click', async () => {
    const btn = container.querySelector('#check-updates');
    const resultEl = container.querySelector('#update-result');
    btn.disabled = true;
    resultEl.className = 'hint';
    resultEl.textContent = 'Checking...';

    const result = await window.api.update.check();

    if (result.error) {
      resultEl.className = 'error';
      resultEl.textContent = `Couldn't check for updates: ${result.error}`;
    } else if (result.isNewer) {
      resultEl.className = 'hint';
      resultEl.innerHTML = `A newer version (v${result.latestVersion}) is available. <button type="button" class="link-button" id="open-release">View release</button>`;
      resultEl.querySelector('#open-release').addEventListener('click', () => {
        window.api.update.openReleasePage(result.releaseUrl);
      });
    } else {
      resultEl.className = 'hint';
      resultEl.textContent = `You're up to date (v${result.currentVersion}).`;
    }

    btn.disabled = false;
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
      showToast('Passphrase changed.');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
}
