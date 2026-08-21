// Clients list (internally still "Person" -- see person.js's repository
// comment for why the UI wording and the code/schema naming
// deliberately differ), with inline "add" and a link into the detail
// view (which handles their notes, platform accounts, and orders).

import { escapeHtml, formatDateTime, daysSince, formatDaysSince } from '../helpers.js';
import { openModal } from '../modal.js';
import { renderImportPanel } from '../importPanel.js';

export function renderPeopleView(container, { navigate, quietOnly }) {
  container.innerHTML = `
    <div class="section-header">
      <h1>Clients</h1>
      <button type="button" class="btn-secondary" id="import-client-btn">Import client</button>
    </div>
    <form id="create-form" class="inline-form">
      <input type="text" id="private-label" placeholder="Private label (a nickname you'll recognize)" required />
      <button type="submit">Add client</button>
    </form>
    <p class="error" id="error" hidden></p>

    <div class="toolbar">
      <label>
        Filter by tag
        <select id="filter-tag">
          <option value="">All</option>
        </select>
      </label>
      <label>
        Flag quiet after (days)
        <input type="number" id="quiet-threshold-input" min="1" max="365" />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="quiet-only-filter" ${quietOnly ? 'checked' : ''} /> Show quiet clients only
      </label>
    </div>

    <table class="data-table">
      <thead><tr><th>Label</th><th>Tags</th><th>Last order</th><th>Added</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="5" class="loading-state">Loading…</td></tr></tbody>
    </table>
  `;

  const errorEl = container.querySelector('#error');
  const rowsEl = container.querySelector('#rows');
  const filterSelect = container.querySelector('#filter-tag');
  const quietOnlyCheckbox = container.querySelector('#quiet-only-filter');
  const thresholdInput = container.querySelector('#quiet-threshold-input');

  let allPeople = [];
  let tagsByPerson = {};
  let lastOrderByPerson = {};
  let quietThresholdDays = 30;

  async function refresh() {
    const [people, groupedTags, allTags, lastOrderMap, thresholdDays] = await Promise.all([
      window.api.person.listAll(),
      window.api.tag.listGroupedByPerson(),
      window.api.tag.listAll(),
      window.api.order.listLastOrderDateByPerson(),
      window.api.settings.getQuietClientThresholdDays(),
    ]);
    allPeople = people;
    tagsByPerson = groupedTags;
    lastOrderByPerson = lastOrderMap;
    quietThresholdDays = thresholdDays ?? 30;
    thresholdInput.value = quietThresholdDays;
    renderTagFilterOptions(allTags);
    render();
  }

  function renderTagFilterOptions(allTags) {
    const previousValue = filterSelect.value;
    filterSelect.innerHTML = `
      <option value="">All</option>
      ${allTags.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}
    `;
    // Keep the current selection if that tag still exists, otherwise
    // falls back to "All" -- e.g. after removing the last client tagged
    // with whatever's currently filtered on.
    if (allTags.some((t) => String(t.id) === previousValue)) filterSelect.value = previousValue;
  }

  // A client with no orders at all was never really "heard from" to
  // begin with, so daysSince() returning null (never ordered) never
  // counts as quiet -- only someone who *has* ordered before and has
  // since gone past the threshold does.
  function isQuiet(personId) {
    const days = daysSince(lastOrderByPerson[personId]);
    return days !== null && days >= quietThresholdDays;
  }

  function render() {
    let people = allPeople;

    if (filterSelect.value) {
      const tagId = Number(filterSelect.value);
      people = people.filter((p) => (tagsByPerson[p.id] || []).some((t) => t.id === tagId));
    }
    if (quietOnlyCheckbox.checked) {
      people = people.filter((p) => isQuiet(p.id));
    }

    if (people.length === 0) {
      rowsEl.innerHTML = `<tr><td colspan="5" class="muted">${
        allPeople.length === 0 ? 'No clients yet.' : 'No clients match this filter.'
      }</td></tr>`;
      return;
    }

    rowsEl.innerHTML = people
      .map((p) => {
        const tags = tagsByPerson[p.id] || [];
        const days = daysSince(lastOrderByPerson[p.id]);
        const quiet = days !== null && days >= quietThresholdDays;
        return `
        <tr>
          <td><button class="link-button" data-open="${p.id}">${escapeHtml(p.private_label)}</button></td>
          <td>${
            tags.length
              ? `<div class="tag-list">${tags.map((t) => `<span class="tag-chip">${escapeHtml(t.label)}</span>`).join('')}</div>`
              : ''
          }</td>
          <td class="${quiet ? 'quiet-client' : ''}">${formatDaysSince(days)}</td>
          <td>${formatDateTime(p.created_at)}</td>
          <td><button class="danger btn-sm" data-delete="${p.id}">Delete</button></td>
        </tr>`;
      })
      .join('');

    rowsEl.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.open) }));
    });
    rowsEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this client, and all their linked platform accounts and orders?')) return;
        await window.api.person.delete(Number(btn.dataset.delete));
        refresh();
      });
    });
  }

  filterSelect.addEventListener('change', render);
  quietOnlyCheckbox.addEventListener('change', render);

  thresholdInput.addEventListener('change', async () => {
    const days = Number(thresholdInput.value) || 30;
    thresholdInput.value = days;
    quietThresholdDays = days;
    await window.api.settings.setQuietClientThresholdDays(days);
    render();
  });

  // Same underlying flow as Settings' "Import" card (see
  // src/renderer/importPanel.js) -- just surfaced here too, since this is
  // where you'd actually look for it while managing clients.
  container.querySelector('#import-client-btn').addEventListener('click', () => {
    openModal({
      title: 'Import client or order',
      wide: true,
      render: (body, close) => {
        renderImportPanel(body, {
          onImported: () => {
            close();
            refresh();
          },
        });
      },
    });
  });

  container.querySelector('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    const input = container.querySelector('#private-label');
    try {
      await window.api.person.create({ privateLabel: input.value });
      input.value = '';
      refresh();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  refresh();
}
