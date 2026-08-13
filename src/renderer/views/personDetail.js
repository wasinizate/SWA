// Person detail view: notes, platform accounts, purchase totals, and a
// condensed list of orders. Full order editing (status, amount,
// description, calculator, feedback, attachments) lives on each order's
// own page -- see orderDetail.js -- reached by clicking a row here or by
// creating a new order, which drops you straight onto its page (the same
// "click New Ticket, land on the ticket" flow as a ticketing system).

import { escapeHtml, formatMoney, buildStatusOptions } from '../helpers.js';

export function renderPersonDetailView(container, { navigate, personId }) {
  container.innerHTML = '<p>Loading...</p>';
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
        <h2>Notes</h2>
        <form id="notes-form">
          <label>General notes<textarea id="general-notes" rows="3">${escapeHtml(person.general_notes)}</textarea></label>
          <label>Screening notes<textarea id="screening-notes" rows="3">${escapeHtml(person.screening_notes)}</textarea></label>
          <button type="submit">Save notes</button>
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
          <tbody id="account-rows"></tbody>
        </table>
      </section>

      <section class="card">
        <div class="section-header">
          <h2>Orders</h2>
          <button type="button" id="new-order">+ New order</button>
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
          <div id="totals-body"></div>
          <p class="hint">Excludes cancelled orders and orders without a recorded payment date.</p>
        </div>

        <table class="data-table">
          <thead><tr><th>#</th><th>Date paid</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody id="order-rows"></tbody>
        </table>
      </section>
    `;

    container.querySelector('#back').addEventListener('click', () => navigate('people'));

    container.querySelector('#notes-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await window.api.person.update(personId, {
        generalNotes: container.querySelector('#general-notes').value,
        screeningNotes: container.querySelector('#screening-notes').value,
      });
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

    await refreshAccounts();
    await refreshOrders();
    await refreshTotals();

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
