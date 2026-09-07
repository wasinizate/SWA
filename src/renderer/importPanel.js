// Shared cross-instance import UI (see src/main/dataExchange/ and
// dataExchangeIpc.js for the backend -- a single file/passphrase in,
// auto-detects whether it's a whole client or a single order, previews
// the diff, then applies it). Originally lived inline in settings.js;
// pulled out here so the "Import client"/"Import order" entry points on
// people.js/orders.js can show the exact same flow instead of a second,
// possibly-drifting copy of it.

import { escapeHtml, formatMoney, orderStatusLabel, previewText } from './helpers.js';

// Formats a single diff value for display in the change list below --
// money/status get their usual display treatment, long text fields get
// truncated so one changed description doesn't blow out the list.
// Exported: also used by settings.js's shared-sync "pending updates"
// list (src/main/sync/), which shows the exact same
// previewImport()-shaped diffs, just sourced from the sync folder
// instead of a manually-picked file.
export function formatDiffValue(fieldKey, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (fieldKey === 'amountCents') return formatMoney(value);
  if (fieldKey === 'status') return orderStatusLabel(value);
  if (['description', 'feedbackNotes', 'generalNotes', 'screeningNotes'].includes(fieldKey)) return previewText(value, 60);
  return String(value);
}

export function renderChangesList(changes) {
  return `<ul class="import-changes-list">${Object.entries(changes)
    .map(
      ([key, c]) =>
        `<li>${escapeHtml(c.label)}: ${escapeHtml(formatDiffValue(key, c.local))} &rarr; ${escapeHtml(formatDiffValue(key, c.incoming))}</li>`
    )
    .join('')}</ul>`;
}

// Renders the whole import flow into `container` (replaces its
// innerHTML). `onImported`, if given, fires once with applyImport()'s
// result after a successful import -- callers hosting this inside a
// modal (people.js/orders.js) use it to close the dialog and refresh
// their list; settings.js's own copy leaves it unset and just shows the
// result in place, same as before this was extracted.
export function renderImportPanel(container, { onImported } = {}) {
  container.innerHTML = `
    <p class="hint">
      Import a client or order exported from another install of this app
      (see "Export client"/"Export order" on a client's or order's own
      page) -- you'll need the passphrase whoever exported it chose, not
      their vault passphrase.
    </p>
    <div class="inline-form">
      <input type="file" id="import-file-input" accept=".swaexport" />
      <input type="password" id="import-passphrase" placeholder="Passphrase" />
      <button type="button" id="import-preview-btn" class="btn-secondary">Preview</button>
    </div>
    <div id="import-preview-body"></div>
    <p class="error" id="import-error" hidden></p>
  `;

  let pendingImportFileContents = null;

  container.querySelector('#import-preview-btn').addEventListener('click', async () => {
    const errorEl = container.querySelector('#import-error');
    const previewBody = container.querySelector('#import-preview-body');
    errorEl.hidden = true;
    previewBody.innerHTML = '';

    const fileInput = container.querySelector('#import-file-input');
    const passphrase = container.querySelector('#import-passphrase').value;
    const file = fileInput.files[0];
    if (!file) {
      errorEl.textContent = 'Choose a file first.';
      errorEl.hidden = false;
      return;
    }

    try {
      pendingImportFileContents = await file.text();
      const preview = await window.api.dataExchange.previewImport(pendingImportFileContents, passphrase);
      renderImportPreview(preview, passphrase);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  function renderImportPreview(preview, passphrase) {
    const previewBody = container.querySelector('#import-preview-body');

    const orderSummary = `${preview.newOrderCount} new order(s)${preview.updates.length > 0 ? `, ${preview.updates.length} with changes` : ''}`;

    const hasPersonChanges = preview.personChanges && Object.keys(preview.personChanges).length > 0;
    const hasChanges = hasPersonChanges || preview.updates.length > 0;

    // Shown for both the resolved and (once a client's picked, after
    // re-preview) unresolved-going-resolved cases -- but only actually
    // populated when resolved, since there's nothing to diff against
    // until a local client is known (see previewImport()).
    const changesHtml = `
      ${
        hasPersonChanges
          ? `<div class="import-change-block"><strong>Client details</strong>${renderChangesList(preview.personChanges)}</div>`
          : ''
      }
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
              library yet -- they'll be added as title-only placeholders you can fill in (type, price, location)
              afterward.
            </p>`
          : ''
      }
    `;

    const applyUpdatesCheckboxHtml = hasChanges
      ? `<label class="checkbox-label"><input type="checkbox" id="import-apply-updates" checked /> Apply these updates</label>`
      : '';

    if (preview.resolved) {
      previewBody.innerHTML = `
        <p class="hint">This will attach ${orderSummary} to your existing client "${escapeHtml(preview.resolvedPersonLabel)}".</p>
        ${changesHtml}
        ${applyUpdatesCheckboxHtml}
        <button type="button" id="import-confirm-btn">Import</button>
      `;
      previewBody.querySelector('#import-confirm-btn').addEventListener('click', () => {
        const applyUpdates = hasChanges ? previewBody.querySelector('#import-apply-updates').checked : true;
        runImport(passphrase, { attachToPersonId: preview.resolvedPersonId, applyUpdates });
      });
      return;
    }

    previewBody.innerHTML = `
      <p class="hint">
        This export is for "${escapeHtml(preview.personLabel)}" (${orderSummary}), which isn't linked to
        a client in your system yet. Attach it to an existing client, or create a new one --
        whichever you pick is remembered, so future imports for this same client (in either
        direction) attach automatically from now on.
      </p>
      <label>
        Attach to
        <select id="import-person-select">
          <option value="new">-- Create as new client --</option>
          ${preview.people.map((p) => `<option value="${p.id}">${escapeHtml(p.private_label)}</option>`).join('')}
        </select>
      </label>
      <button type="button" id="import-confirm-btn">Import</button>
    `;
    previewBody.querySelector('#import-confirm-btn').addEventListener('click', () => {
      const selected = previewBody.querySelector('#import-person-select').value;
      const resolution = selected === 'new' ? { createNew: true } : { attachToPersonId: Number(selected) };
      runImport(passphrase, resolution);
    });
  }

  async function runImport(passphrase, resolution) {
    const errorEl = container.querySelector('#import-error');
    const previewBody = container.querySelector('#import-preview-body');
    errorEl.hidden = true;

    try {
      const result = await window.api.dataExchange.applyImport(pendingImportFileContents, passphrase, resolution);
      const parts = [`${result.ordersImported} new order(s)`];
      if (result.ordersUpdated > 0) parts.push(`${result.ordersUpdated} updated`);
      if (result.attachmentsAdded > 0) parts.push(`${result.attachmentsAdded} new attachment(s)`);
      if (result.contentItemsAttached > 0) parts.push(`${result.contentItemsAttached} content item(s) attached`);
      if (result.contentItemsCreated > 0) parts.push(`${result.contentItemsCreated} new content library placeholder(s)`);
      previewBody.innerHTML = `<p class="hint">Imported to "${escapeHtml(result.personLabel)}": ${parts.join(', ')}.</p>`;
      container.querySelector('#import-file-input').value = '';
      container.querySelector('#import-passphrase').value = '';
      pendingImportFileContents = null;
      if (onImported) onImported(result);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }
}
