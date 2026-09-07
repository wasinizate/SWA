// One content item's own page: editable fields, tags (shared with
// clients -- see contentItem.js's comments), and its sales history.
// Mirrors personDetail.js's shape.

import { escapeHtml, formatMoney, formatBytes, formatDateTime, CONTENT_TYPE_PRESETS } from '../helpers.js';
import { showToast } from '../toast.js';
import { attachTagAutocomplete } from '../tagAutocomplete.js';
import { priceSliderHtml, wirePriceSlider } from '../priceSlider.js';

export function renderContentDetailView(container, { navigate, contentItemId }) {
  container.innerHTML = '<p class="loading-state">Loading…</p>';
  load();

  async function load() {
    const item = await window.api.contentItem.get(contentItemId);
    if (!item) {
      container.innerHTML = '<p>Content item not found.</p><button id="back" type="button">Back to Content library</button>';
      container.querySelector('#back').addEventListener('click', () => navigate('contentLibrary'));
      return;
    }

    container.innerHTML = `
      <button class="link-button" id="back" type="button">&larr; Back to Content library</button>
      <h1>${escapeHtml(item.title)}</h1>
      ${
        item.is_scanned
          ? `<p class="hint">📁 Scanned from library${item.last_scanned_at ? `, last seen ${formatDateTime(item.last_scanned_at)}` : ''}.</p>`
          : ''
      }
      ${
        item.folder_missing
          ? `<div class="folder-missing-banner">
              ⚠ This folder wasn't found during the last scan -- it may have been moved, renamed, or
              its drive isn't connected. Nothing below was changed.
            </div>`
          : ''
      }

      <section class="card">
        <h2>Details</h2>
        <form id="details-form">
          <label>Title <input type="text" id="ci-title" value="${escapeHtml(item.title)}" required /></label>
          <label>
            Type
            <input type="text" id="ci-type" value="${escapeHtml(item.content_type)}" list="ci-type-options" />
            <datalist id="ci-type-options">
              ${CONTENT_TYPE_PRESETS.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}
            </datalist>
          </label>
          <label>Description <textarea id="ci-description" rows="4">${escapeHtml(item.description)}</textarea></label>
          <label>
            Location
            <span class="inline-form">
              <input type="text" id="ci-location" value="${escapeHtml(item.location)}" placeholder="Where the file lives -- a folder, drive, or link" />
              <button type="button" class="btn-secondary" id="ci-open-folder">Open folder</button>
            </span>
          </label>
          <div class="form-actions">
            <button type="submit">Save changes</button>
            <button type="button" class="danger" id="ci-delete">Delete</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2>Price</h2>
        <p class="hint">
          ${
            item.is_scanned
              ? "The set price below is for the whole folder as a bundle. If it has multiple files, each one can also carry its own price in the Files card -- e.g. \"this video is $10, this whole set is $25.\""
              : 'What you\'d normally ask for this item.'
          }
        </p>
        <label>
          ${item.is_scanned ? 'Set price' : 'Price'}
          ${priceSliderHtml({ idPrefix: 'ci-price', valueCents: item.price_cents })}
        </label>
      </section>

      ${
        item.is_scanned
          ? `<section class="card">
              <h2>Files</h2>
              <p class="hint">Per-file prices are optional -- leave a file at $0 to price it only as part of the set above.</p>
              <div id="files-body"><p class="loading-state">Loading…</p></div>
            </section>`
          : ''
      }

      <section class="card">
        <h2>Tags</h2>
        <div id="tag-list" class="tag-list"></div>
        <form id="tag-form" class="inline-form">
          <input type="text" id="tag-input" placeholder="Add a tag (shared with client tags)" autocomplete="off" />
          <button type="submit" class="btn-secondary">Add</button>
        </form>
      </section>

      <section class="card">
        <h2>Sales</h2>
        <div id="sales-body"><p class="loading-state">Loading…</p></div>
      </section>
    `;

    container.querySelector('#back').addEventListener('click', () => navigate('contentLibrary'));

    container.querySelector('#ci-open-folder').addEventListener('click', async () => {
      const targetPath = container.querySelector('#ci-location').value.trim();
      if (!targetPath) {
        showToast('No location set for this item.');
        return;
      }
      try {
        await window.api.contentScan.openPath(targetPath);
      } catch (err) {
        showToast(err.message || "Couldn't open that location.");
      }
    });

    container.querySelector('#details-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const updated = await window.api.contentItem.update(contentItemId, {
        title: container.querySelector('#ci-title').value,
        contentType: container.querySelector('#ci-type').value,
        description: container.querySelector('#ci-description').value,
        location: container.querySelector('#ci-location').value,
      });
      container.querySelector('h1').textContent = updated.title;
      showToast('Saved.');
    });

    // ---- Price (its own card/save action, separate from Details) -----

    wirePriceSlider(container, 'ci-price', async (priceCents) => {
      await window.api.contentItem.update(contentItemId, { priceCents });
      showToast('Price saved.');
    });

    container.querySelector('#ci-delete').addEventListener('click', async () => {
      if (!confirm('Delete this content item? It will be removed from any orders it was attached to.')) return;
      await window.api.contentItem.delete(contentItemId);
      navigate('contentLibrary');
    });

    // ---- Tags -------------------------------------------------------

    const tagInput = container.querySelector('#tag-input');
    let allTagLabels = [];

    async function addTag(label) {
      const trimmed = label.trim();
      if (!trimmed) return;
      await window.api.contentItem.addTag(contentItemId, trimmed);
      tagInput.value = '';
      await refreshTags();
    }

    container.querySelector('#tag-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await addTag(tagInput.value);
    });

    attachTagAutocomplete({
      input: tagInput,
      getOptions: () => allTagLabels,
      onSelect: addTag,
    });

    async function refreshTags() {
      const [tags, allTags] = await Promise.all([window.api.contentItem.listTagsFor(contentItemId), window.api.tag.listAll()]);
      allTagLabels = allTags.map((t) => t.label);

      const listEl = container.querySelector('#tag-list');
      listEl.innerHTML = tags.length
        ? tags
            .map(
              (t) => `
            <span class="tag-chip">
              ${escapeHtml(t.label)}
              <button type="button" class="tag-chip-remove" data-remove-tag="${t.id}" aria-label="Remove ${escapeHtml(t.label)}">&times;</button>
            </span>`
            )
            .join('')
        : '<p class="muted">No tags yet.</p>';

      listEl.querySelectorAll('[data-remove-tag]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await window.api.contentItem.removeTag(contentItemId, Number(btn.dataset.removeTag));
          await refreshTags();
        });
      });
    }

    // ---- Sales --------------------------------------------------------

    async function refreshSales() {
      const sales = await window.api.contentItem.getSalesDetail(contentItemId);
      const body = container.querySelector('#sales-body');

      if (sales.length === 0) {
        body.innerHTML = '<p class="muted">No confirmed sales yet.</p>';
        return;
      }

      // Prefer each sale's recorded price-paid override (this item's
      // actual contribution to that order) and only fall back to the
      // order's full amount when no override was set -- see
      // contentItem.js's getSalesDetail()/listAll() comments.
      const totalCents = sales.reduce((sum, s) => sum + (s.price_paid_cents ?? s.amount_cents), 0);
      const anyApproximated = sales.some((s) => s.price_paid_cents === null);
      body.innerHTML = `
        <p class="hint">
          ${sales.length} sale${sales.length === 1 ? '' : 's'}, ${formatMoney(totalCents)} total.
          ${anyApproximated ? ' Rows marked ~ use the full order amount because no price-paid override was recorded on that order.' : ''}
        </p>
        <table class="data-table">
          <thead><tr><th>Client</th><th>Order</th><th>Date paid</th><th>Amount</th></tr></thead>
          <tbody>
            ${sales
              .map(
                (s) => `
              <tr>
                <td><button class="link-button" data-open-person="${s.person_id}">${escapeHtml(s.person_label)}</button></td>
                <td><button class="link-button" data-open-order="${s.order_id}">#${s.order_id}</button></td>
                <td>${s.date_paid ?? ''}</td>
                <td>${s.price_paid_cents === null ? '~ ' : ''}${formatMoney(s.price_paid_cents ?? s.amount_cents, s.currency)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;

      body.querySelectorAll('[data-open-person]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openPerson) }));
      });
      body.querySelectorAll('[data-open-order]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
      });
    }

    // ---- Files (scanned items only, see scanner/contentScanner.js) --

    async function refreshFiles() {
      const body = container.querySelector('#files-body');
      if (!body) return; // card only rendered when item.is_scanned

      const files = await window.api.contentItem.listFiles(contentItemId);
      if (files.length === 0) {
        body.innerHTML = '<p class="muted">No files indexed.</p>';
        return;
      }

      body.innerHTML = `
        <table class="data-table">
          <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Modified</th><th>Price</th></tr></thead>
          <tbody>
            ${files
              .map(
                (f) => `
              <tr>
                <td>${escapeHtml(f.relative_path)}</td>
                <td>${escapeHtml(f.extension)}</td>
                <td>${formatBytes(f.size_bytes)}</td>
                <td>${f.modified_at ? formatDateTime(f.modified_at) : ''}</td>
                <td><input type="number" class="file-price-input" data-file-id="${f.id}" step="0.01" min="0" value="${(f.price_cents / 100).toFixed(2)}" /></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        <div class="form-actions">
          <button type="button" class="btn-secondary btn-sm" id="save-file-prices">Save file prices</button>
        </div>
      `;

      body.querySelector('#save-file-prices').addEventListener('click', async () => {
        const updates = Array.from(body.querySelectorAll('.file-price-input')).map((input) => ({
          id: Number(input.dataset.fileId),
          priceCents: Math.round(Number.parseFloat(input.value) * 100) || 0,
        }));
        await window.api.contentItem.setFilePrices(contentItemId, updates);
        showToast('File prices saved.');
      });
    }

    await refreshTags();
    await refreshSales();
    await refreshFiles();
  }
}
