// Clients list (internally still "Person" -- see person.js's repository
// comment for why the UI wording and the code/schema naming
// deliberately differ), with inline "add" and a link into the detail
// view (which handles their notes, platform accounts, and orders).

import {
  escapeHtml,
  formatDateTime,
  formatMoney,
  daysSince,
  formatDaysSince,
  PRIORITY_OPTIONS,
  priorityBadgeHtml,
  followUpDateInDays,
  FOLLOW_UP_PRESETS,
  ipcErrorMessage,
} from '../helpers.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { renderImportPanel } from '../importPanel.js';
import { openPersonLinkModal } from '../personLinkModal.js';

export function renderPeopleView(container, { navigate, quietOnly, focusAddForm, linkingWithPersonId }) {
  container.innerHTML = `
    <div class="section-header">
      <h1>Clients</h1>
      <button type="button" class="btn-secondary" id="import-client-btn">Import client</button>
    </div>
    ${
      linkingWithPersonId
        ? `<div class="linking-banner">
            <span>Picking a client to link or merge with <strong id="linking-with-label">…</strong>. Click a name below to choose.</span>
            <button type="button" class="btn-secondary btn-sm" id="cancel-linking">Cancel</button>
          </div>`
        : ''
    }
    <form id="create-form" class="inline-form">
      <input type="text" id="private-label" placeholder="Nickname, or paste a profile link" required />
      <button type="submit" id="add-client-btn">Add client</button>
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
        Filter by priority
        <select id="filter-priority">
          <option value="">All</option>
          ${PRIORITY_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
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
      <thead id="clients-thead"></thead>
      <tbody id="rows"><tr><td colspan="7" class="loading-state">Loading…</td></tr></tbody>
    </table>
  `;

  const errorEl = container.querySelector('#error');
  const theadEl = container.querySelector('#clients-thead');
  const rowsEl = container.querySelector('#rows');
  const filterSelect = container.querySelector('#filter-tag');
  const priorityFilterSelect = container.querySelector('#filter-priority');
  const quietOnlyCheckbox = container.querySelector('#quiet-only-filter');
  const thresholdInput = container.querySelector('#quiet-threshold-input');

  let allPeople = [];
  let tagsByPerson = {};
  let accountsByPerson = {};
  let lastOrderByPerson = {};
  let lifetimeSpendByPerson = {};
  let quietThresholdDays = 30;

  // Sortable columns -- each a comparator plus which direction makes
  // sense to start on. Money/dates default to descending (highest
  // spend, most recent first -- what you'd actually want first look at,
  // matching the "decide who deserves attention" framing the Client
  // value card elsewhere uses); label/priority default ascending
  // (alphabetical / low-to-high) since "descending" has no obviously
  // more useful meaning for those. Tags has no single sortable value,
  // so it's left out of this map entirely -- renderTableHead() below
  // only makes a <th> clickable when a column has an entry here.
  const SORT_COLUMNS = {
    label: {
      title: 'Label',
      defaultDirection: 'asc',
      compare: (a, b) => a.private_label.localeCompare(b.private_label),
    },
    priority: {
      title: 'Priority',
      defaultDirection: 'asc',
      // PRIORITY_OPTIONS is itself already low -> normal -> vip, so its
      // index doubles as an importance rank without a separate lookup.
      compare: (a, b) =>
        PRIORITY_OPTIONS.findIndex((o) => o.value === (a.priority || 'normal')) -
        PRIORITY_OPTIONS.findIndex((o) => o.value === (b.priority || 'normal')),
    },
    spend: {
      title: 'Lifetime spend',
      defaultDirection: 'desc',
      compare: (a, b) => (lifetimeSpendByPerson[a.id] || 0) - (lifetimeSpendByPerson[b.id] || 0),
    },
    lastOrder: {
      title: 'Last order',
      defaultDirection: 'desc',
      // A client who's never ordered sorts as "oldest" (-Infinity), not
      // first-on-ascending/last-on-descending by some arbitrary Date
      // parse of undefined -- same "never ordered isn't quiet" reasoning
      // isQuiet() below already applies to this same data.
      compare: (a, b) => {
        const aTime = lastOrderByPerson[a.id] ? new Date(lastOrderByPerson[a.id]).getTime() : -Infinity;
        const bTime = lastOrderByPerson[b.id] ? new Date(lastOrderByPerson[b.id]).getTime() : -Infinity;
        return aTime - bTime;
      },
    },
    added: {
      title: 'Added',
      defaultDirection: 'desc',
      compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
  };
  let sortKey = 'label';
  let sortDirection = SORT_COLUMNS.label.defaultDirection;

  async function refresh() {
    const [people, groupedTags, allTags, lastOrderMap, lifetimeSpendMap, thresholdDays, groupedAccounts] = await Promise.all([
      window.api.person.listAll(),
      window.api.tag.listGroupedByPerson(),
      window.api.tag.listAll(),
      window.api.order.listLastOrderDateByPerson(),
      window.api.order.listLifetimeSpendByPerson(),
      window.api.settings.getQuietClientThresholdDays(),
      window.api.platformAccount.listGroupedByPerson(),
    ]);
    // Excluded from the list entirely while linking -- picking yourself
    // as the "other" client makes no sense, and person.js's own
    // create()/mergeInto() guards would just reject it anyway.
    allPeople = linkingWithPersonId ? people.filter((p) => p.id !== linkingWithPersonId) : people;
    tagsByPerson = groupedTags;
    accountsByPerson = groupedAccounts;
    lastOrderByPerson = lastOrderMap;
    lifetimeSpendByPerson = lifetimeSpendMap;
    quietThresholdDays = thresholdDays ?? 30;
    thresholdInput.value = quietThresholdDays;
    renderTagFilterOptions(allTags);
    render();
  }

  function renderTagFilterOptions(allTags) {
    // tag.listAll() returns every tag in the shared vocabulary,
    // including ones only ever used on a content item (see
    // tag.js/contentItem.js) -- filtered down to tags with at least one
    // client here so this dropdown can't offer an option that would
    // always show "no clients match", same reasoning contentLibrary.js's
    // own tag filter uses (built only from tags its items actually have).
    const clientTags = allTags.filter((t) => t.usage_count > 0);

    const previousValue = filterSelect.value;
    filterSelect.innerHTML = `
      <option value="">All</option>
      ${clientTags.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}
    `;
    // Keep the current selection if that tag still exists, otherwise
    // falls back to "All" -- e.g. after removing the last client tagged
    // with whatever's currently filtered on.
    if (clientTags.some((t) => String(t.id) === previousValue)) filterSelect.value = previousValue;
  }

  // Each client's handles under their name, so an identity can be spotted
  // without opening anyone. The platform is in the tooltip.
  function handlesHtml(personId) {
    const accounts = accountsByPerson[personId] || [];
    if (accounts.length === 0) return '';
    const handles = accounts
      .map((a) => {
        const handle = /^[@/]|[\s/]/.test(a.username) ? a.username : `@${a.username}`;
        return `<span title="${escapeHtml(a.platformName)}">${escapeHtml(handle)}</span>`;
      })
      .join(' · ');
    return `<div class="client-handles">${handles}</div>`;
  }

  // A client with no orders at all was never really "heard from" to
  // begin with, so daysSince() returning null (never ordered) never
  // counts as quiet -- only someone who *has* ordered before and has
  // since gone past the threshold does.
  function isQuiet(personId) {
    const days = daysSince(lastOrderByPerson[personId]);
    return days !== null && days >= quietThresholdDays;
  }

  // Rebuilt on every render() call (sort state can change on any click),
  // same "just regenerate the whole thing" approach the <tbody> below
  // already uses -- cheap at this row/column count, and it keeps the
  // header's sort-indicator arrow trivially in sync with sortKey/
  // sortDirection without a separate DOM-patching path.
  function renderTableHead() {
    const cells = [
      `<th data-sort="label">${sortIndicator('label')}Label</th>`,
      `<th data-sort="priority">${sortIndicator('priority')}Priority</th>`,
      `<th>Tags</th>`,
      `<th data-sort="spend">${sortIndicator('spend')}Lifetime spend</th>`,
      `<th data-sort="lastOrder">${sortIndicator('lastOrder')}Last order</th>`,
      `<th data-sort="added">${sortIndicator('added')}Added</th>`,
      `<th></th>`,
    ];
    theadEl.innerHTML = `<tr>${cells.join('')}</tr>`;

    theadEl.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDirection = SORT_COLUMNS[key].defaultDirection;
        }
        render();
      });
    });
  }

  function sortIndicator(key) {
    if (key !== sortKey) return '';
    return sortDirection === 'asc' ? '▲ ' : '▼ ';
  }

  function render() {
    renderTableHead();

    let people = allPeople;

    if (filterSelect.value) {
      const tagId = Number(filterSelect.value);
      people = people.filter((p) => (tagsByPerson[p.id] || []).some((t) => t.id === tagId));
    }
    if (priorityFilterSelect.value) {
      people = people.filter((p) => (p.priority || 'normal') === priorityFilterSelect.value);
    }
    if (quietOnlyCheckbox.checked) {
      people = people.filter((p) => isQuiet(p.id));
    }

    const { compare } = SORT_COLUMNS[sortKey];
    people = [...people].sort((a, b) => (sortDirection === 'asc' ? compare(a, b) : -compare(a, b)));

    if (people.length === 0) {
      rowsEl.innerHTML = `<tr><td colspan="7" class="muted">${
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
          <td>
            <button class="link-button" data-open="${p.id}">${escapeHtml(p.private_label)}</button>
            ${handlesHtml(p.id)}
          </td>
          <td>${priorityBadgeHtml(p.priority)}</td>
          <td>${
            tags.length
              ? `<div class="tag-list">${tags.map((t) => `<span class="tag-chip">${escapeHtml(t.label)}</span>`).join('')}</div>`
              : ''
          }</td>
          <td>${formatMoney(lifetimeSpendByPerson[p.id] || 0)}</td>
          <td class="${quiet ? 'quiet-client' : ''}">${formatDaysSince(days)}</td>
          <td>${formatDateTime(p.created_at)}</td>
          <td>
            <div class="row-actions row-actions-nowrap">
              <button class="btn-secondary btn-sm" data-note="${p.id}">+ Note</button>
              <button class="danger btn-sm" data-delete="${p.id}">Delete</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    rowsEl.querySelectorAll('[data-note]').forEach((btn) => {
      btn.addEventListener('click', () => toggleQuickNote(btn));
    });

    rowsEl.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (linkingWithPersonId) {
          openPersonLinkModal({
            personAId: linkingWithPersonId,
            personBId: Number(btn.dataset.open),
            // replace: this pick-a-client list is a one-off step, not a
            // page Back should return to.
            onResolved: (survivorId) =>
              navigate('personDetail', { personId: survivorId || linkingWithPersonId }, { replace: true }),
          });
          return;
        }
        navigate('personDetail', { personId: Number(btn.dataset.open) });
      });
    });
    rowsEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this client, and all their linked platform accounts and orders?')) return;
        await window.api.person.delete(Number(btn.dataset.delete));
        refresh();
      });
    });
  }

  // Log an Activity note (optionally with a follow-up) without opening the
  // client's page. Opens as a one-line form directly under that client's
  // row; only one is open at a time, and it closes after logging, on the
  // x, on Escape, or by clicking "+ Note" again.
  function toggleQuickNote(btn) {
    const clientRow = btn.closest('tr');
    const openRow = rowsEl.querySelector('.quick-note-row');
    const wasOpenHere = openRow && openRow.previousElementSibling === clientRow;
    if (openRow) openRow.remove();
    if (wasOpenHere) return;

    const person = allPeople.find((p) => p.id === Number(btn.dataset.note));
    const noteRow = document.createElement('tr');
    noteRow.className = 'quick-note-row';
    noteRow.innerHTML = `
      <td colspan="7">
        <form class="inline-form quick-note-form">
          <input type="text" class="quick-note-text" placeholder="Note for ${escapeHtml(person.private_label)}" required />
          <select class="quick-note-follow-up">
            <option value="">No follow-up</option>
            ${FOLLOW_UP_PRESETS.map((p) => `<option value="${p.days}">Follow up in ${p.label}</option>`).join('')}
          </select>
          <button type="submit" class="btn-secondary">Log</button>
          <button type="button" class="icon-button quick-note-cancel" aria-label="Cancel">&times;</button>
        </form>
      </td>
    `;
    clientRow.after(noteRow);

    const form = noteRow.querySelector('form');
    const textInput = noteRow.querySelector('.quick-note-text');
    textInput.focus();

    const close = () => noteRow.remove();
    noteRow.querySelector('.quick-note-cancel').addEventListener('click', close);
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = textInput.value.trim();
      if (!text) return;
      const days = noteRow.querySelector('.quick-note-follow-up').value;
      await window.api.personInteraction.create(person.id, {
        type: 'note',
        text,
        followUpDate: days ? followUpDateInDays(Number(days)) : null,
      });
      close();
      showToast(days ? `Follow-up flagged for ${person.private_label}.` : `Note logged for ${person.private_label}.`);
    });
  }

  filterSelect.addEventListener('change', render);
  priorityFilterSelect.addEventListener('change', render);
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

  // A pasted profile link (onlyfans.com/jordan_m) adds the client *and*
  // that account in one go -- see personIpc.js's addFromProfileLink().
  // Anything else is a plain nickname, same as always.
  const addInput = container.querySelector('#private-label');
  const addBtn = container.querySelector('#add-client-btn');
  const looksLikeLink = (value) => /^\S+\.\S+\/\S+$/.test(value.trim()) || /^https?:\/\//i.test(value.trim());
  addInput.addEventListener('input', () => {
    addBtn.textContent = looksLikeLink(addInput.value) ? 'Add from link' : 'Add client';
  });

  container.querySelector('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    try {
      if (looksLikeLink(addInput.value)) {
        const result = await window.api.person.addFromProfileLink(addInput.value);
        const handle = `${result.platformName} @${result.username}`;
        if (result.existing) {
          // Already have them: go there instead of making a duplicate.
          showToast(`${handle} is already ${result.label}.`);
          navigate('personDetail', { personId: result.personId });
          return;
        }
        showToast(`Added ${result.label} (${handle}).`);
      } else {
        await window.api.person.create({ privateLabel: addInput.value });
      }
      addInput.value = '';
      addBtn.textContent = 'Add client';
      refresh();
    } catch (err) {
      errorEl.textContent = ipcErrorMessage(err);
      errorEl.hidden = false;
    }
  });

  // The "/new-client" slash command (see commands.js) lands here wanting
  // the add-client field ready to type into immediately.
  if (focusAddForm) container.querySelector('#private-label').focus();

  if (linkingWithPersonId) {
    container.querySelector('#cancel-linking').addEventListener('click', () => navigate.back('personDetail', { personId: linkingWithPersonId }));
    window.api.person.get(linkingWithPersonId).then((origin) => {
      const label = container.querySelector('#linking-with-label');
      if (label && origin) label.textContent = origin.private_label;
    });
  }

  refresh();
}
