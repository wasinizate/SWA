// Clients list (internally still "Person" -- see person.js's repository
// comment for why the UI wording and the code/schema naming
// deliberately differ), with inline "add" and a link into the detail
// view (which handles their notes, platform accounts, and orders).

import { escapeHtml, formatDateTime } from '../helpers.js';

export function renderPeopleView(container, { navigate }) {
  container.innerHTML = `
    <h1>Clients</h1>
    <form id="create-form" class="inline-form">
      <input type="text" id="private-label" placeholder="Private label (a nickname you'll recognize)" required />
      <button type="submit">Add client</button>
    </form>
    <p class="error" id="error" hidden></p>
    <table class="data-table">
      <thead><tr><th>Label</th><th>Added</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="3" class="loading-state">Loading…</td></tr></tbody>
    </table>
  `;

  const errorEl = container.querySelector('#error');
  const rowsEl = container.querySelector('#rows');

  async function refresh() {
    const people = await window.api.person.listAll();

    if (people.length === 0) {
      rowsEl.innerHTML = '<tr><td colspan="3" class="muted">No clients yet.</td></tr>';
      return;
    }

    rowsEl.innerHTML = people
      .map(
        (p) => `
        <tr>
          <td><button class="link-button" data-open="${p.id}">${escapeHtml(p.private_label)}</button></td>
          <td>${formatDateTime(p.created_at)}</td>
          <td><button class="danger btn-sm" data-delete="${p.id}">Delete</button></td>
        </tr>`
      )
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
