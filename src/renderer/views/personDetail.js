// Person detail view: notes, platform accounts, purchase totals, and a
// condensed list of orders. Full order editing (status, amount,
// description, calculator, feedback, attachments) lives on each order's
// own page -- see orderDetail.js -- reached by clicking a row here or by
// creating a new order, which drops you straight onto its page (the same
// "click New Ticket, land on the ticket" flow as a ticketing system).

import { escapeHtml, formatMoney, buildStatusOptions, loadingHtml } from '../helpers.js';
import { promptForPassphrase } from '../exportPassphrasePrompt.js';
import { showToast } from '../toast.js';

export function renderPersonDetailView(container, { navigate, personId }) {
  container.innerHTML = loadingHtml();
  load();

  async function load() {
    const person = await window.api.person.get(personId);
    if (!person) {
      container.innerHTML = '<p>Client not found.</p><button id="back" type="button">Back to Clients</button>';
      container.querySelector('#back').addEventListener('click', () => navigate('people'));
      return;
    }

    container.innerHTML = `
      <button class="link-button" id="back" type="button">&larr; Back to Clients</button>
      <h1>${escapeHtml(person.private_label)}</h1>

      <section class="card">
        <label class="checkbox-label">
          <input type="checkbox" id="person-shared" ${person.is_shared ? 'checked' : ''} />
          Shared with collaborators -- syncs (all of their orders) via the shared folder configured in Settings
        </label>
      </section>

      <section class="card">
        <h2>Notes</h2>
        <form id="notes-form">
          <label>General notes<textarea id="general-notes" rows="3">${escapeHtml(person.general_notes)}</textarea></label>
          <label>Screening notes<textarea id="screening-notes" rows="3">${escapeHtml(person.screening_notes)}</textarea></label>
          <button type="submit">Save notes</button>
        </form>
      </section>

      <section class="card">
        <h2>Tags</h2>
        <div id="tag-list" class="tag-list"></div>
        <form id="tag-form" class="inline-form">
          <input type="text" id="tag-input" placeholder="Add a tag (e.g. regular, verified)" list="tag-options" />
          <datalist id="tag-options"></datalist>
          <button type="submit" class="btn-secondary">Add</button>
        </form>
      </section>

      <section class="card">
        <h2>Platform accounts</h2>
        <form id="account-form" class="inline-form">
          <input type="text" id="platform-name" placeholder="Platform (e.g. OnlyFans)" required />
          <input type="text" id="username" placeholder="Username / handle" required />
          <label class="checkbox-label"><input type="checkbox" id="verified" /> Verified</label>
          <button type="submit">Add account</button>
        </form>
        <table class="data-table">
          <thead><tr><th>Platform</th><th>Username</th><th>Verified</th><th></th></tr></thead>
          <tbody id="account-rows"><tr><td colspan="4" class="loading-state">Loading…</td></tr></tbody>
        </table>
      </section>

      <section class="card">
        <div class="section-header">
          <h2>Orders</h2>
          <div class="row-actions">
            <button type="button" class="btn-secondary" id="export-client">Export client</button>
            <button type="button" id="new-order">+ New order</button>
          </div>
        </div>

        <div class="totals-card">
          <div class="totals-header">
            <h3>Client totals</h3>
            <div class="totals-toggle">
              <button type="button" class="totals-tab active" data-period="all">All time</button>
              <button type="button" class="totals-tab" data-period="year">By year</button>
              <button type="button" class="totals-tab" data-period="month">By month</button>
            </div>
          </div>
          <div id="totals-body">${loadingHtml()}</div>
          <p class="hint">Excludes cancelled orders and orders without a recorded payment date.</p>
        </div>

        <table class="data-table">
          <thead><tr><th>#</th><th>Date paid</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody id="order-rows"><tr><td colspan="4" class="loading-state">Loading…</td></tr></tbody>
        </table>
      </section>
    `;

    container.querySelector('#back').addEventListener('click', () => navigate('people'));

    container.querySelector('#person-shared').addEventListener('change', async (event) => {
      await window.api.person.update(personId, { isShared: event.target.checked });
      showToast(event.target.checked ? 'Now syncing with collaborators.' : 'No longer shared.');
    });

    container.querySelector('#notes-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await window.api.person.update(personId, {
        generalNotes: container.querySelector('#general-notes').value,
        screeningNotes: container.querySelector('#screening-notes').value,
      });
      showToast('Notes saved.');
    });

    container.querySelector('#tag-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = container.querySelector('#tag-input');
      const label = input.value.trim();
      if (!label) return;
      await window.api.tag.addToPerson(personId, label);
      input.value = '';
      await refreshTags();
    });

    container.querySelector('#account-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await window.api.platformAccount.create({
        personId,
        platformName: container.querySelector('#platform-name').value,
        username: container.querySelector('#username').value,
        verified: container.querySelector('#verified').checked,
      });
      container.querySelector('#account-form').reset();
      await refreshAccounts();
    });

    // "New order" creates a blank order immediately and drops you onto
    // its own page to fill in the rest -- like clicking "New Ticket" in a
    // ticketing system. An empty $0 order left behind if you back out
    // without saving anything is one click to delete from that page.
    container.querySelector('#new-order').addEventListener('click', async () => {
      const order = await window.api.order.create({ personId, status: 'pending', amountCents: 0 });
      navigate('orderDetail', { orderId: order.id });
    });

    // Exports this client + every one of their orders (attachments
    // included) to a passphrase-encrypted file -- see settings.js's
    // "Import" card for the other half of this. Meant for handing a
    // shared client off to someone else running their own instance of
    // this app, not as a general backup mechanism.
    container.querySelector('#export-client').addEventListener('click', async () => {
      const passphrase = await promptForPassphrase({
        title: 'Export client',
        helpText:
          "Choose a passphrase to protect this file, then share it with the recipient a different way than the file itself (e.g. tell them in person or a separate message) -- not your vault passphrase.",
      });
      if (!passphrase) return;

      try {
        const savedPath = await window.api.dataExchange.exportPerson(personId, passphrase);
        if (savedPath) showToast(`Saved to: ${savedPath}`);
      } catch (err) {
        alert(`Failed to export: ${err.message}`);
      }
    });

    // ---- Totals ---------------------------------------------------------

    let totalsPeriod = 'all';

    async function refreshTotals() {
      const totals = await window.api.order.getTotalsByPerson(personId);
      const body = container.querySelector('#totals-body');

      if (totalsPeriod === 'all') {
        body.innerHTML = `<p class="totals-all-time">${formatMoney(totals.allTimeCents)}</p>`;
        return;
      }

      const rows = totalsPeriod === 'year' ? totals.byYear : totals.byMonth;
      const columnLabel = totalsPeriod === 'year' ? 'Year' : 'Month';
      body.innerHTML = rows.length
        ? `<table class="data-table"><thead><tr><th>${columnLabel}</th><th>Total</th></tr></thead><tbody>${rows
            .map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${formatMoney(row.total_cents)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="muted">No paid orders yet.</p>';
    }

    container.querySelectorAll('.totals-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        totalsPeriod = tab.dataset.period;
        container.querySelectorAll('.totals-tab').forEach((t) => t.classList.toggle('active', t === tab));
        refreshTotals();
      });
    });

    // ---- Initial data load ------------------------------------------------

    await refreshTags();
    await refreshAccounts();
    await refreshOrders();
    await refreshTotals();

    async function refreshTags() {
      const [tags, allTags] = await Promise.all([window.api.tag.listForPerson(personId), window.api.tag.listAll()]);

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
          await window.api.tag.removeFromPerson(personId, Number(btn.dataset.removeTag));
          await refreshTags();
        });
      });

      // Every tag that exists anywhere, not just this person's -- that's
      // the point of autocomplete: reuse existing spelling instead of
      // accidentally creating "Regular" and "regular" as two tags (the
      // UNIQUE COLLATE NOCASE column would actually prevent that exact
      // case, but matching case-insensitively up front avoids relying on
      // the constraint to paper over a near-miss).
      container.querySelector('#tag-options').innerHTML = allTags.map((t) => `<option value="${escapeHtml(t.label)}"></option>`).join('');
    }

    async function refreshAccounts() {
      const accounts = await window.api.platformAccount.listByPerson(personId);
      const rows = container.querySelector('#account-rows');

      rows.innerHTML =
        accounts.length === 0
          ? '<tr><td colspan="4" class="muted">No platform accounts yet.</td></tr>'
          : accounts
              .map(
                (a) => `
              <tr>
                <td>${escapeHtml(a.platform_name)}</td>
                <td>${escapeHtml(a.username)}</td>
                <td>${a.verified ? 'Yes' : 'No'}</td>
                <td><button class="danger btn-sm" data-delete-account="${a.id}">Delete</button></td>
              </tr>`
              )
              .join('');

      rows.querySelectorAll('[data-delete-account]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this platform account? Linked orders are kept but unlinked.')) return;
          await window.api.platformAccount.delete(Number(btn.dataset.deleteAccount));
          await refreshAccounts();
          await refreshOrders();
        });
      });
    }

    async function refreshOrders() {
      const orders = await window.api.order.listByPerson(personId);
      // "Placed" order, newest first -- date_paid is NULL for anything
      // not yet paid, which would otherwise bury pending orders.
      orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const rows = container.querySelector('#order-rows');

      rows.innerHTML =
        orders.length === 0
          ? '<tr><td colspan="4" class="muted">No orders yet.</td></tr>'
          : orders
              .map(
                (o) => `
              <tr>
                <td><button class="link-button" data-open-order="${o.id}">#${o.id}</button></td>
                <td>${o.date_paid ?? ''}</td>
                <td>${formatMoney(o.amount_cents, o.currency)}</td>
                <td><select class="quick-status" data-quick-status="${o.id}">${buildStatusOptions(o.status)}</select></td>
              </tr>`
              )
              .join('');

      rows.querySelectorAll('[data-open-order]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
      });

      rows.querySelectorAll('.quick-status').forEach((select) => {
        const order = orders.find((o) => o.id === Number(select.dataset.quickStatus));
        select.value = order.status;
        select.addEventListener('change', async () => {
          await window.api.order.update(order.id, { status: select.value });
          await refreshOrders();
          await refreshTotals();
        });
      });
    }
  }
}
