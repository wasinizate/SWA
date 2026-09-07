// Settings: auto-lock timeout, order due-date desktop reminders, the
// opt-in quick-unlock toggle, appearance (theme), and changing the vault
// passphrase. Grouped into General / Security & Privacy / Data so the
// page reads as sections instead of one long stack of identical cards.

import { escapeHtml, loadingHtml, parseMoneyToCents } from '../helpers.js';
import { THEMES, applyTheme, getCurrentTheme } from '../theme.js';
import { showToast } from '../toast.js';
import { renderImportPanel, renderChangesList } from '../importPanel.js';
import { openModal } from '../modal.js';
import { promptForPassphrase } from '../exportPassphrasePrompt.js';
import { createLineItemRows } from '../lineItemRows.js';

// Accepts { navigate } for signature consistency with every other view
// (shell.js always passes it) -- not currently used here since this
// page has no navigation of its own.
export function renderSettingsView(container, { navigate } = {}) {
  container.innerHTML = `
    <h1>Settings</h1>

    <h3 class="settings-group-label">General</h3>

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
      <p class="hint">Desktop popups for upcoming order due dates.</p>
      <div id="order-reminder-body">${loadingHtml()}</div>
    </section>

    <h3 class="settings-group-label">Security &amp; privacy</h3>

    <section class="card">
      <h2>Privacy</h2>
      <p class="hint">
        Off by default -- SWA makes zero network requests until enabled.
        Needed for the update check below.
      </p>
      <label class="checkbox-label">
        <input type="checkbox" id="network-access-toggle" /> Enable network access
      </label>
    </section>

    <section class="card">
      <h2>Updates</h2>
      <p class="hint">Manual only. Checks GitHub for a newer release; nothing else is sent.</p>
      <button id="check-updates" type="button" class="btn-secondary">Check for updates</button>
      <p class="hint" id="update-result"></p>
    </section>

    <section class="card">
      <h2>Quick unlock</h2>
      <p class="hint">
        Skip retyping your passphrase by wrapping it with this OS's secure
        storage. Anyone logged in as you could unlock the vault too --
        avoid on a shared computer.
      </p>
      <div id="quick-unlock-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Recovery phrase</h2>
      <p class="hint">
        6 random words that can unlock this vault if you forget your
        passphrase. Shown once -- write them down and store them
        somewhere safe.
      </p>
      <div id="recovery-body">${loadingHtml()}</div>
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

    <h3 class="settings-group-label">Data</h3>

    <section class="card">
      <h2>Import</h2>
      <div id="import-panel-body"></div>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>Price templates</h2>
        <button type="button" class="btn-secondary" id="new-price-template-btn">+ New template</button>
      </div>
      <p class="hint">Reusable line-item sets for an order's price calculator.</p>
      <div id="price-template-list-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Tags</h2>
      <p class="hint">Rename to fix a typo, or delete one that's no longer useful -- both apply everywhere the tag is used.</p>
      <div id="tag-management-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Shared-folder sync</h2>
      <p class="hint">
        Keeps clients marked "Shared with collaborators" in sync via a
        folder (Dropbox, OneDrive, etc.) -- no network calls of its own.
        Incoming changes always need your review below. Runs in the
        background every 15 minutes while enabled below, or hit "Sync
        now" any time to push/pull immediately -- that works even with
        background sync turned off, as long as a folder and passphrase
        are set.
      </p>
      <div id="sync-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Backup &amp; restore</h2>
      <p class="hint">
        A full, encrypted copy of your database -- protect the file like
        you would <code>data.db</code> itself. Restoring replaces
        everything (today's data is saved first, just in case).
      </p>
      <div class="form-actions">
        <button type="button" id="create-backup" class="btn-secondary">Create backup</button>
        <button type="button" id="restore-backup" class="btn-secondary">Restore from backup</button>
      </div>
      <p class="hint" id="backup-result"></p>
    </section>
  `;

  init();

  // Auto-lock/Order-reminders/Quick-unlock/Recovery-phrase all show a
  // loading placeholder (see the template above) until their data
  // actually arrives, rather than painting default/unchecked values and
  // visibly flipping them a moment later once init()'s Promise.all
  // resolves -- each section's real controls are only ever built once
  // its data is in hand.
  async function init() {
    const [timeoutSeconds, status, orderReminderConfig] = await Promise.all([
      window.api.vault.getIdleTimeoutSeconds(),
      window.api.vault.status(),
      window.api.settings.getOrderDueReminderConfig(),
    ]);

    renderAutoLock(timeoutSeconds);
    renderOrderReminder(orderReminderConfig);
    renderQuickUnlock(status.quickUnlockEnabled);
    renderRecovery(status);
    renderImportPanel(container.querySelector('#import-panel-body'));
    refreshPriceTemplates();
    refreshTagManagement();
    refreshSync();
    refreshNetworkAccess();

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

    await refreshNetworkAccess();
  });

  // ---- Privacy / network access lock ------------------------------------
  // Master switch (default off -- see src/main/security/networkGuard.js)
  // gating every network-capable feature. The actual enforcement lives
  // in the main process regardless of what's shown here; this just
  // keeps "Check for updates" from being clickable (and confusing) while
  // locked.

  async function refreshNetworkAccess() {
    const enabled = await window.api.settings.getNetworkAccessEnabled();
    container.querySelector('#network-access-toggle').checked = enabled;

    const btn = container.querySelector('#check-updates');
    const resultEl = container.querySelector('#update-result');
    btn.disabled = !enabled;
    if (!enabled) {
      resultEl.className = 'hint';
      resultEl.textContent = 'Locked -- enable network access in Privacy above to check for updates.';
    } else if (resultEl.textContent.startsWith('Locked --')) {
      resultEl.textContent = '';
    }
  }

  container.querySelector('#network-access-toggle').addEventListener('change', async (event) => {
    const wantsEnabled = event.target.checked;

    if (wantsEnabled) {
      const confirmed = confirm(
        'Allow this app to make network requests?\n\nThis currently only enables "Check for updates" below. Nothing happens automatically -- you still have to click that button yourself.'
      );
      if (!confirmed) {
        event.target.checked = false;
        return;
      }
    }

    await window.api.settings.setNetworkAccessEnabled(wantsEnabled);
    await refreshNetworkAccess();
    showToast(wantsEnabled ? 'Network access enabled.' : 'Network access locked.');
  });

  // ---- Recovery phrase ---------------------------------------------------
  // Opt-in, wraps the *current* passphrase with a key derived from 6
  // random words (src/main/security/recoveryPhrase.js) -- functionally a
  // second master key, so generating/regenerating always re-confirms the
  // current passphrase first via the same promptForPassphrase() modal
  // used elsewhere. Changing the passphrase invalidates it (the old blob
  // only decrypts back to a passphrase that no longer works) -- the
  // change-passphrase handler below surfaces that when it happens.

  function renderRecovery(status) {
    const body = container.querySelector('#recovery-body');
    body.innerHTML = status.recoveryEnabled
      ? `
        <p class="hint">Recovery phrase is set.</p>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="regenerate-recovery">Generate a new one</button>
          <button type="button" class="danger" id="turn-off-recovery">Turn off</button>
        </div>`
      : `<button type="button" id="generate-recovery" class="btn-secondary">Generate recovery phrase</button>`;

    const generateBtn = body.querySelector('#generate-recovery') || body.querySelector('#regenerate-recovery');
    generateBtn.addEventListener('click', async () => {
      const currentPassphrase = await promptForPassphrase({
        title: 'Generate recovery phrase',
        confirmLabel: 'Continue',
        helpText: 'Enter your current passphrase to continue.',
      });
      if (!currentPassphrase) return;

      let result;
      try {
        result = await window.api.vault.generateRecoveryPhrase(currentPassphrase);
      } catch (err) {
        alert(err.message);
        return;
      }

      // Already persisted -- reflect it now regardless of how the
      // word-reveal modal below gets dismissed.
      renderRecovery(result.status);
      showToast('Recovery phrase set.');
      showRecoveryWordsModal(result.words);
    });

    const turnOffBtn = body.querySelector('#turn-off-recovery');
    if (turnOffBtn) {
      turnOffBtn.addEventListener('click', async () => {
        if (!confirm("Turn off the recovery phrase? The words you wrote down won't work anymore.")) return;
        const newStatus = await window.api.vault.clearRecoveryPhrase();
        renderRecovery(newStatus);
        showToast('Recovery phrase turned off.');
      });
    }
  }

  function showRecoveryWordsModal(words) {
    openModal({
      title: 'Your recovery phrase',
      render: (body, close) => {
        body.innerHTML = `
          <p class="hint">Write these down and store them somewhere safe -- they won't be shown again.</p>
          <ol class="recovery-words">
            ${words.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
          </ol>
          <label class="checkbox-label">
            <input type="checkbox" id="recovery-confirm" /> I've written these words down somewhere safe
          </label>
          <div class="form-actions">
            <button type="button" id="recovery-done" disabled>Done</button>
          </div>
        `;
        const checkbox = body.querySelector('#recovery-confirm');
        const doneBtn = body.querySelector('#recovery-done');
        checkbox.addEventListener('change', () => {
          doneBtn.disabled = !checkbox.checked;
        });
        doneBtn.addEventListener('click', close);
      },
    });
  }

  // ---- Price templates -------------------------------------------------

  async function refreshPriceTemplates() {
    const templates = await window.api.priceTemplate.listAll();
    const body = container.querySelector('#price-template-list-body');

    body.innerHTML = templates.length
      ? `
        <table class="data-table">
          <thead><tr><th>Platform</th><th>Label</th><th>Items</th><th>Default discount</th><th></th></tr></thead>
          <tbody>
            ${templates
              .map(
                (t) => `
              <tr>
                <td>${escapeHtml(t.platform_name)}</td>
                <td>${escapeHtml(t.label)}</td>
                <td>${t.items.length}</td>
                <td>${t.default_discount_percent ? `${t.default_discount_percent}%` : '—'}</td>
                <td class="row-actions">
                  <button type="button" class="btn-secondary btn-sm" data-edit-template="${t.id}">Edit</button>
                  <button type="button" class="danger btn-sm" data-delete-template="${t.id}">Delete</button>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`
      : '<p class="muted">No price templates yet.</p>';

    body.querySelectorAll('[data-edit-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const template = templates.find((t) => t.id === Number(btn.dataset.editTemplate));
        openPriceTemplateModal(template);
      });
    });

    body.querySelectorAll('[data-delete-template]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this price template?')) return;
        await window.api.priceTemplate.delete(Number(btn.dataset.deleteTemplate));
        await refreshPriceTemplates();
      });
    });
  }

  // `template` is null for "+ New template", or an existing template
  // (with its .items) for Edit -- same optional-source pattern as
  // calendar.js's openEventModal().
  function openPriceTemplateModal(template) {
    const isEditing = Boolean(template);

    openModal({
      title: isEditing ? 'Edit price template' : 'New price template',
      wide: true,
      render: (body, close) => {
        body.innerHTML = `
          <form id="price-template-form">
            <div class="inline-form">
              <input type="text" id="pt-platform" placeholder="Platform (e.g. OnlyFans)" value="${isEditing ? escapeHtml(template.platform_name) : ''}" required />
              <input type="text" id="pt-label" placeholder="Label (e.g. Custom video)" value="${isEditing ? escapeHtml(template.label) : ''}" required />
              <label>
                Default discount %
                <input type="number" id="pt-discount" min="0" max="100" step="0.1" value="${isEditing ? template.default_discount_percent : 0}" />
              </label>
            </div>
            <table class="data-table">
              <thead><tr><th>Item</th><th>Rate ($/unit)</th><th>Default qty</th><th>Subtotal</th><th></th></tr></thead>
              <tbody id="pt-rows"></tbody>
            </table>
            <button type="button" class="btn-secondary btn-sm" id="pt-add-row">Add line</button>
            <div class="form-actions">
              <button type="submit">Save template</button>
            </div>
          </form>
        `;

        const rows = createLineItemRows({ tbody: body.querySelector('#pt-rows') });
        if (isEditing) rows.setLines(template.items);

        body.querySelector('#pt-add-row').addEventListener('click', () => rows.addLine());

        body.querySelector('#price-template-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          const lines = rows.getLines().filter((line) => line.label || line.rate || line.qty);
          const payload = {
            platformName: body.querySelector('#pt-platform').value,
            label: body.querySelector('#pt-label').value,
            defaultDiscountPercent: Number.parseFloat(body.querySelector('#pt-discount').value) || 0,
            items: lines.map((line) => ({
              label: line.label,
              rateCents: parseMoneyToCents(line.rate),
              defaultQty: Number.parseFloat(line.qty) || 0,
            })),
          };

          if (isEditing) {
            await window.api.priceTemplate.update(template.id, payload);
          } else {
            await window.api.priceTemplate.create(payload);
          }
          close();
          showToast('Template saved.');
          await refreshPriceTemplates();
        });
      },
    });
  }

  container.querySelector('#new-price-template-btn').addEventListener('click', () => openPriceTemplateModal(null));

  // ---- Tags --------------------------------------------------------------
  // Renaming/deleting here affects the one shared `tags` row, not a
  // per-client copy -- see src/main/db/repositories/tag.js. No modal for
  // rename: a single text field doesn't need one, so it swaps in place
  // like an inline edit.

  // A tag is shared between clients (person_tags) and content items
  // (content_item_tags) -- see tag.js's listAll() comment -- so "used
  // by" has to report both, not just the client count, or deleting a
  // content-only tag would look consequence-free when it isn't.
  function tagUsagePhrase(tag) {
    const parts = [];
    if (tag.usage_count > 0) parts.push(`${tag.usage_count} client${tag.usage_count === 1 ? '' : 's'}`);
    if (tag.content_usage_count > 0) parts.push(`${tag.content_usage_count} content item${tag.content_usage_count === 1 ? '' : 's'}`);
    return parts.length ? parts.join(', ') : 'Unused';
  }

  async function refreshTagManagement() {
    const tags = await window.api.tag.listAll();
    const body = container.querySelector('#tag-management-body');

    body.innerHTML = tags.length
      ? `
        <table class="data-table">
          <thead><tr><th>Label</th><th>Used by</th><th></th></tr></thead>
          <tbody>
            ${tags
              .map(
                (t) => `
              <tr data-tag-row="${t.id}">
                <td class="tag-label-cell">${escapeHtml(t.label)}</td>
                <td>${tagUsagePhrase(t)}</td>
                <td class="row-actions">
                  <button type="button" class="btn-secondary btn-sm" data-rename-tag="${t.id}">Rename</button>
                  <button type="button" class="danger btn-sm" data-delete-tag="${t.id}">Delete</button>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`
      : '<p class="muted">No tags yet -- add one from a client\'s or content item\'s page.</p>';

    body.querySelectorAll('[data-rename-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = tags.find((t) => t.id === Number(btn.dataset.renameTag));
        startRenamingTag(body.querySelector(`[data-tag-row="${tag.id}"]`), tag);
      });
    });

    body.querySelectorAll('[data-delete-tag]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tag = tags.find((t) => t.id === Number(btn.dataset.deleteTag));
        const isUnused = tag.usage_count === 0 && tag.content_usage_count === 0;
        const consequence = isUnused ? "it isn't used anywhere yet" : `it will be removed from ${tagUsagePhrase(tag)}`;
        if (!confirm(`Delete the tag "${tag.label}"? ${consequence[0].toUpperCase()}${consequence.slice(1)}.`)) return;
        await window.api.tag.delete(tag.id);
        showToast('Tag deleted.');
        await refreshTagManagement();
      });
    });
  }

  function startRenamingTag(row, tag) {
    const cell = row.querySelector('.tag-label-cell');
    cell.innerHTML = `
      <form class="inline-form" id="rename-tag-form">
        <input type="text" value="${escapeHtml(tag.label)}" required autofocus />
        <button type="submit" class="btn-secondary btn-sm">Save</button>
        <button type="button" class="btn-secondary btn-sm" id="rename-tag-cancel">Cancel</button>
      </form>
    `;

    cell.querySelector('#rename-tag-cancel').addEventListener('click', refreshTagManagement);
    cell.querySelector('#rename-tag-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const newLabel = cell.querySelector('input').value;
      try {
        await window.api.tag.rename(tag.id, newLabel);
        showToast('Tag renamed.');
        await refreshTagManagement();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // ---- Shared-folder sync ------------------------------------------------

  async function refreshSync() {
    const status = await window.api.sync.getStatus();
    renderSync(status);
  }

  function renderSync(status) {
    const body = container.querySelector('#sync-body');
    body.innerHTML = `
      <div class="inline-form">
        <label class="checkbox-label">
          <input type="checkbox" id="sync-enabled" ${status.enabled ? 'checked' : ''} /> Enable shared-folder sync
        </label>
        <button type="button" class="btn-secondary" id="sync-now">Sync now</button>
      </div>
      <label>
        Sync folder
        <div class="inline-form">
          <input type="text" id="sync-folder-path" value="${escapeHtml(status.folderPath)}" placeholder="No folder chosen yet" readonly />
          <button type="button" class="btn-secondary" id="sync-choose-folder">Choose folder…</button>
        </div>
      </label>
      <div id="sync-passphrase-section">
        ${
          status.hasPassphrase
            ? `<p class="hint">Sync passphrase is set (matches what your collaborators use).</p>
               <button type="button" class="btn-secondary" id="sync-clear-passphrase">Clear passphrase</button>`
            : `<label>Sync passphrase <input type="password" id="sync-passphrase-input" placeholder="Chosen once, shared with collaborators separately" /></label>
               <button type="button" id="sync-set-passphrase">Set passphrase</button>`
        }
      </div>
      <p class="error" id="sync-error" hidden></p>
      <h3>Pending updates</h3>
      <div id="sync-pending-body">${loadingHtml()}</div>
    `;

    const errorEl = body.querySelector('#sync-error');

    body.querySelector('#sync-enabled').addEventListener('change', async (event) => {
      await window.api.sync.setEnabled(event.target.checked);
      showToast(event.target.checked ? 'Sync enabled.' : 'Sync disabled.');
    });

    body.querySelector('#sync-now').addEventListener('click', async () => {
      const btn = body.querySelector('#sync-now');
      btn.disabled = true;
      const previousLabel = btn.textContent;
      btn.textContent = 'Syncing…';
      try {
        const result = await window.api.sync.runNow();
        showToast(
          result.newPendingCount > 0
            ? `Synced. ${result.newPendingCount} update(s) waiting for your review below.`
            : 'Synced. Nothing new.'
        );
        await refreshPending();
      } catch (err) {
        showToast(err.message || 'Sync failed.');
      } finally {
        btn.disabled = false;
        btn.textContent = previousLabel;
      }
    });

    body.querySelector('#sync-choose-folder').addEventListener('click', async () => {
      const folderPath = await window.api.sync.pickFolder();
      if (folderPath) {
        body.querySelector('#sync-folder-path').value = folderPath;
        showToast('Sync folder set.');
      }
    });

    const setPassBtn = body.querySelector('#sync-set-passphrase');
    if (setPassBtn) {
      setPassBtn.addEventListener('click', async () => {
        errorEl.hidden = true;
        const pass = body.querySelector('#sync-passphrase-input').value;
        try {
          await window.api.sync.setPassphrase(pass);
          showToast('Sync passphrase set.');
          await refreshSync();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
        }
      });
    }

    const clearPassBtn = body.querySelector('#sync-clear-passphrase');
    if (clearPassBtn) {
      clearPassBtn.addEventListener('click', async () => {
        if (!confirm('Clear the sync passphrase? Sync stops working until a new one (matching your collaborators\') is set.')) return;
        await window.api.sync.clearPassphrase();
        showToast('Sync passphrase cleared.');
        await refreshSync();
      });
    }

    refreshPending();
  }

  async function refreshPending() {
    const pendingBody = container.querySelector('#sync-pending-body');
    if (!pendingBody) return; // the Sync card may have re-rendered since this was scheduled

    const pending = await window.api.sync.listPending();
    if (pending.length === 0) {
      pendingBody.innerHTML = '<p class="muted">Nothing pending.</p>';
      return;
    }

    pendingBody.innerHTML = pending.map((item) => renderPendingItemHtml(item)).join('');
    pending.forEach((item) => wirePendingItem(pendingBody.querySelector(`[data-pending-item="${item.id}"]`), item));
  }

  // Same preview shape (and the same field-level diff formatting, via
  // the imported renderChangesList) as the manual Import flow's preview
  // card -- this is deliberately the exact same "review before applying"
  // pattern, just sourced from the sync folder instead of a picked file.
  function renderPendingItemHtml(item) {
    const preview = item.preview;
    const orderSummary = `${preview.newOrderCount} new order(s)${preview.updates.length > 0 ? `, ${preview.updates.length} with changes` : ''}`;
    const hasPersonChanges = preview.personChanges && Object.keys(preview.personChanges).length > 0;

    const changesHtml = `
      ${hasPersonChanges ? `<div class="import-change-block"><strong>Client details</strong>${renderChangesList(preview.personChanges)}</div>` : ''}
      ${preview.updates
        .map(
          (u) => `
        <div class="import-change-block">
          <strong>Order changes</strong>
          ${renderChangesList(u.changes)}
          ${u.newAttachmentCount > 0 ? `<p class="hint">+ ${u.newAttachmentCount} new attachment(s)</p>` : ''}
          ${u.newContentItemCount > 0 ? `<p class="hint">+ ${u.newContentItemCount} content item(s) attached</p>` : ''}
        </div>`
        )
        .join('')}
      ${
        preview.newPlaceholderContentItemCount > 0
          ? `<p class="hint">
              ${preview.newPlaceholderContentItemCount} content item(s) referenced here aren't in your Content
              library yet -- they'll be added as title-only placeholders you can fill in afterward.
            </p>`
          : ''
      }
    `;

    if (preview.resolved) {
      return `
        <div class="card" data-pending-item="${escapeHtml(item.id)}">
          <p class="hint">${orderSummary} for "${escapeHtml(preview.resolvedPersonLabel)}".</p>
          ${changesHtml}
          <div class="form-actions">
            <button type="button" class="btn-secondary" data-pending-apply>Apply</button>
            <button type="button" class="btn-secondary" data-pending-dismiss>Dismiss</button>
          </div>
        </div>`;
    }

    return `
      <div class="card" data-pending-item="${escapeHtml(item.id)}">
        <p class="hint">
          This is for "${escapeHtml(preview.personLabel)}" (${orderSummary}), not linked to a
          client here yet. Attach it to an existing client, or create a new one.
        </p>
        <label>
          Attach to
          <select data-pending-resolution>
            <option value="new">-- Create as new client --</option>
            ${preview.people.map((p) => `<option value="${p.id}">${escapeHtml(p.private_label)}</option>`).join('')}
          </select>
        </label>
        <div class="form-actions">
          <button type="button" class="btn-secondary" data-pending-apply>Apply</button>
          <button type="button" class="btn-secondary" data-pending-dismiss>Dismiss</button>
        </div>
      </div>`;
  }

  function wirePendingItem(itemEl, item) {
    if (!itemEl) return;

    itemEl.querySelector('[data-pending-apply]').addEventListener('click', async () => {
      const resolutionSelect = itemEl.querySelector('[data-pending-resolution]');
      let resolution = {};
      if (resolutionSelect) {
        const selected = resolutionSelect.value;
        resolution = selected === 'new' ? { createNew: true } : { attachToPersonId: Number(selected) };
      }

      try {
        await window.api.sync.applyPending(item.id, resolution);
        showToast('Sync update applied.');
        await refreshPending();
      } catch (err) {
        alert(`Failed to apply: ${err.message}`);
      }
    });

    itemEl.querySelector('[data-pending-dismiss]').addEventListener('click', async () => {
      await window.api.sync.dismissPending(item.id);
      await refreshPending();
    });
  }

  // ---- Backup & restore --------------------------------------------------
  // A backup is a raw copy of the encrypted data.db, not a separate
  // export format -- see src/main/backup/restoreBackup.js. Restoring is
  // destructive (full replace), so it gets its own scary confirmation
  // via promptForPassphrase()'s helpText rather than the quieter
  // "Export client"-style flow.

  container.querySelector('#create-backup').addEventListener('click', async () => {
    const resultEl = container.querySelector('#backup-result');
    const savedPath = await window.api.backup.create();
    if (savedPath) {
      resultEl.className = 'hint';
      resultEl.textContent = `Saved to: ${savedPath}`;
      showToast('Backup created.');
    }
  });

  container.querySelector('#restore-backup').addEventListener('click', async () => {
    const resultEl = container.querySelector('#backup-result');
    const filePath = await window.api.backup.pickFile();
    if (!filePath) return;

    const passphrase = await promptForPassphrase({
      title: 'Restore from backup',
      confirmLabel: 'Restore (replaces everything)',
      helpText: `This will completely replace ALL current data in this vault with the contents of "${filePath}". This cannot be undone, though a copy of today's data is saved first. Enter your vault passphrase to confirm.`,
    });
    if (!passphrase) return;

    try {
      const { safetyCopyPath } = await window.api.backup.restore(filePath, passphrase);
      showToast(`Restored. Your previous data was saved to: ${safetyCopyPath}`);
      location.reload();
    } catch (err) {
      resultEl.className = 'error';
      resultEl.textContent = `Failed to restore: ${err.message}`;
    }
  });

  container.querySelector('#change-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = container.querySelector('#change-error');
    errorEl.hidden = true;

    const next = container.querySelector('#new-passphrase').value;
    const confirmValue = container.querySelector('#confirm-new-passphrase').value;
    if (next !== confirmValue) {
      errorEl.textContent = 'Passphrases do not match.';
      errorEl.hidden = false;
      return;
    }

    try {
      const status = await window.api.vault.changePassphrase(next);
      container.querySelector('#change-form').reset();
      renderRecovery(status);
      showToast(
        status.recoveryCleared
          ? "Passphrase changed. Your recovery phrase was cleared -- set up a new one above if you'd like."
          : 'Passphrase changed.'
      );
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
}
