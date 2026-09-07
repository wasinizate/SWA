// Content library list: a catalog of what's been made, with sales stats
// derived from which orders each item was attached to (see
// orderDetail.js's "Content sold" card and contentDetail.js for the
// per-item view). Same overall shape as people.js -- a filterable
// table, inline "add", link into the detail view.

import { escapeHtml, formatMoney, CONTENT_TYPE_PRESETS } from '../helpers.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';

export function renderContentLibraryView(container, { navigate }) {
  container.innerHTML = `
    <div class="section-header">
      <h1>Content library</h1>
      <button type="button" id="new-content-item-btn">+ New content item</button>
    </div>
    <p class="hint">
      "Sales" is the exact number of confirmed orders this item was attached to. "Revenue" uses the
      "price paid" recorded on each order when one was set, falling back to that order's full amount
      otherwise -- so a bundled or discounted order will overstate per-item revenue unless you record
      what each item actually sold for on that order's "Content sold" card.
    </p>

    <div class="toolbar" id="scan-toolbar">
      <span id="scan-root-label" class="muted">Loading…</span>
      <button type="button" id="scan-choose-folder-btn" class="btn-secondary">Choose folder</button>
      <button type="button" id="scan-run-btn" disabled>Scan now</button>
    </div>
    <p class="hint">
      Point this at a folder on disk -- each subfolder inside it becomes one content item ("a
      set"), and its files get listed (names/sizes only, never opened or copied in). Renaming a
      folder on disk creates a new item on the next scan rather than renaming the old one, and a
      folder that goes missing (unplugged drive, deleted, moved) is flagged, not deleted, so its
      tags/price/sales stay intact.
    </p>

    <div class="toolbar">
      <label>
        Filter by tag
        <select id="filter-tag">
          <option value="">All</option>
        </select>
      </label>
    </div>

    <table class="data-table">
      <thead><tr><th>Title</th><th>Type</th><th>Tags</th><th>Sales</th><th>Revenue</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="6" class="loading-state">Loading…</td></tr></tbody>
    </table>
  `;

  const rowsEl = container.querySelector('#rows');
  const filterSelect = container.querySelector('#filter-tag');
  const scanRootLabel = container.querySelector('#scan-root-label');
  const scanChooseFolderBtn = container.querySelector('#scan-choose-folder-btn');
  const scanRunBtn = container.querySelector('#scan-run-btn');

  let allItems = [];
  let tagsByItem = {};

  async function refreshScanToolbar() {
    const rootPath = await window.api.contentScan.getRootPath();
    scanRootLabel.textContent = rootPath ? `Library folder: ${rootPath}` : 'Library folder: not set';
    scanRunBtn.disabled = !rootPath;
  }

  scanChooseFolderBtn.addEventListener('click', async () => {
    const picked = await window.api.contentScan.pickRootPath();
    if (!picked) return;
    await refreshScanToolbar();
  });

  scanRunBtn.addEventListener('click', async () => {
    scanRunBtn.disabled = true;
    scanChooseFolderBtn.disabled = true;
    const previousLabel = scanRunBtn.textContent;
    scanRunBtn.textContent = 'Scanning…';
    try {
      const summary = await window.api.contentScan.run();
      const parts = [`${summary.created} new`, `${summary.matched} matched`];
      if (summary.missing > 0) parts.push(`${summary.missing} missing`);
      if (summary.skippedFileCount > 0) parts.push(`${summary.skippedFileCount} file(s) skipped at the root`);
      showToast(`Scan complete: ${parts.join(', ')}.`);
      await refresh();
    } catch (err) {
      showToast(err.message || 'Scan failed.');
    } finally {
      scanChooseFolderBtn.disabled = false;
      scanRunBtn.disabled = false;
      scanRunBtn.textContent = previousLabel;
    }
  });

  async function refresh() {
    const items = await window.api.contentItem.listAll();
    allItems = items;

    const tagLists = await Promise.all(items.map((item) => window.api.contentItem.listTagsFor(item.id)));
    tagsByItem = {};
    items.forEach((item, i) => {
      tagsByItem[item.id] = tagLists[i];
    });

    renderTagFilterOptions();
    render();
  }

  function renderTagFilterOptions() {
    const previousValue = filterSelect.value;
    const allTags = [];
    const seen = new Set();
    for (const tags of Object.values(tagsByItem)) {
      for (const tag of tags) {
        if (!seen.has(tag.id)) {
          seen.add(tag.id);
          allTags.push(tag);
        }
      }
    }
    allTags.sort((a, b) => a.label.localeCompare(b.label));

    filterSelect.innerHTML = `
      <option value="">All</option>
      ${allTags.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}
    `;
    if (allTags.some((t) => String(t.id) === previousValue)) filterSelect.value = previousValue;
  }

  function render() {
    let items = allItems;
    if (filterSelect.value) {
      const tagId = Number(filterSelect.value);
      items = items.filter((item) => (tagsByItem[item.id] || []).some((t) => t.id === tagId));
    }

    if (items.length === 0) {
      rowsEl.innerHTML = `<tr><td colspan="6" class="muted">${
        allItems.length === 0 ? 'No content items yet.' : 'No items match this filter.'
      }</td></tr>`;
      return;
    }

    rowsEl.innerHTML = items
      .map((item) => {
        const tags = tagsByItem[item.id] || [];
        return `
        <tr>
          <td>
            <button class="link-button" data-open="${item.id}">${escapeHtml(item.title)}</button>
            ${item.is_scanned ? '<span class="tag-chip">📁 Scanned</span>' : ''}
            ${item.folder_missing ? '<span class="tag-chip tag-chip-danger">⚠ Folder missing</span>' : ''}
          </td>
          <td>${escapeHtml(item.content_type)}</td>
          <td>${
            tags.length
              ? `<div class="tag-list">${tags.map((t) => `<span class="tag-chip">${escapeHtml(t.label)}</span>`).join('')}</div>`
              : ''
          }</td>
          <td>${item.sale_count}</td>
          <td>${formatMoney(item.revenue_cents)}</td>
          <td><button class="danger btn-sm" data-delete="${item.id}">Delete</button></td>
        </tr>`;
      })
      .join('');

    rowsEl.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('contentDetail', { contentItemId: Number(btn.dataset.open) }));
    });
    rowsEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this content item? It will be removed from any orders it was attached to.')) return;
        await window.api.contentItem.delete(Number(btn.dataset.delete));
        refresh();
      });
    });
  }

  filterSelect.addEventListener('change', render);

  container.querySelector('#new-content-item-btn').addEventListener('click', () => {
    openModal({
      title: 'New content item',
      render: (body, close) => {
        body.innerHTML = `
          <form id="content-item-form">
            <label>Title <input type="text" id="ci-title" required autofocus /></label>
            <label>
              Type
              <input type="text" id="ci-type" list="ci-type-options" />
              <datalist id="ci-type-options">
                ${CONTENT_TYPE_PRESETS.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}
              </datalist>
            </label>
            <label>Description <textarea id="ci-description" rows="3"></textarea></label>
            <label>Location <input type="text" id="ci-location" placeholder="Where the file lives -- a folder, drive, or link" /></label>
            <label>Suggested price <input type="number" id="ci-price" step="0.01" min="0" value="0" /></label>
            <div class="form-actions">
              <button type="submit">Save</button>
            </div>
          </form>
        `;

        body.querySelector('#content-item-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          const item = await window.api.contentItem.create({
            title: body.querySelector('#ci-title').value,
            contentType: body.querySelector('#ci-type').value,
            description: body.querySelector('#ci-description').value,
            location: body.querySelector('#ci-location').value,
            priceCents: Math.round(Number.parseFloat(body.querySelector('#ci-price').value) * 100) || 0,
          });
          close();
          showToast('Content item created.');
          await refresh();
          navigate('contentDetail', { contentItemId: item.id });
        });
      },
    });
  });

  refreshScanToolbar();
  refresh();
}
