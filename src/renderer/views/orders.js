// Global "All Orders" view -- browse/delete/export across every client,
// with sorting and status filtering so pending work doesn't get lost.
// Click an order's "#" to open its own page (see orderDetail.js) for full
// editing, or a client's name to jump to their profile instead.

import { escapeHtml, formatMoney, previewText, ORDER_STATUSES, buildStatusOptions } from '../helpers.js';

export function renderOrdersView(container, { navigate }) {
  container.innerHTML = `
    <h1>All Orders</h1>
    <p class="muted">Click an order's # to open it, or a client's name to go to their profile.</p>

    <div class="toolbar">
      <label>
        Status
        <select id="filter-status">
          <option value="">All</option>
          ${ORDER_STATUSES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}
        </select>
      </label>
      <label>
        Sort
        <select id="sort-by">
          <option value="placed_desc">Newest placed</option>
          <option value="placed_asc">Oldest placed</option>
        </select>
      </label>
      <div id="new-order-controls"></div>
    </div>

    <table class="data-table">
      <thead>
        <tr><th>#</th><th>Client</th><th>Date paid</th><th>Amount</th><th>Status</th><th>Payment</th><th>Description</th><th></th></tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  `;

  const rowsEl = container.querySelector('#rows');
  const filterSelect = container.querySelector('#filter-status');
  const sortSelect = container.querySelector('#sort-by');
  const newOrderControls = container.querySelector('#new-order-controls');

  let allOrders = [];
  let allPeople = [];

  async function load() {
    [allOrders, allPeople] = await Promise.all([window.api.order.listAll(), window.api.person.list()]);
    renderNewOrderControls();
    render();
  }

  // A blank order needs a person_id (NOT NULL FK) -- unlike
  // personDetail.js's own "+ New order" button, this page has no person
  // context of its own, so a client picker stands in for it. Creating
  // drops you straight onto the new order's own page to fill in the
  // rest, same flow as personDetail.js's button.
  function renderNewOrderControls() {
    if (allPeople.length === 0) {
      newOrderControls.innerHTML = `<p class="hint">Add a client first to create an order.</p>`;
      return;
    }

    newOrderControls.innerHTML = `
      <label>
        New order for
        <select id="new-order-person">
          ${allPeople.map((p) => `<option value="${p.id}">${escapeHtml(p.private_label)}</option>`).join('')}
        </select>
      </label>
      <button type="button" id="new-order-btn">+ New order</button>
    `;

    newOrderControls.querySelector('#new-order-btn').addEventListener('click', async () => {
      const personId = Number(newOrderControls.querySelector('#new-order-person').value);
      const order = await window.api.order.create({ personId, status: 'pending', amountCents: 0 });
      navigate('orderDetail', { orderId: order.id });
    });
  }

  function render() {
    let orders = allOrders;

    if (filterSelect.value) {
      orders = orders.filter((o) => o.status === filterSelect.value);
    }

    // "Placed" means created_at, not date_paid -- date_paid is NULL for
    // anything not yet paid, which would otherwise bury pending orders
    // at the bottom of a date_paid sort.
    orders = [...orders].sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortSelect.value === 'placed_asc' ? diff : -diff;
    });

    if (orders.length === 0) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="muted">No orders match this filter.</td></tr>';
      return;
    }

    rowsEl.innerHTML = orders
      .map(
        (o) => `
        <tr>
          <td><button class="link-button" data-open-order="${o.id}">#${o.id}</button></td>
          <td><button class="link-button" data-open-person="${o.person_id}">${escapeHtml(o.person_label)}</button></td>
          <td>${o.date_paid ?? ''}</td>
          <td>${formatMoney(o.amount_cents, o.currency)}</td>
          <td><select class="quick-status" data-quick-status="${o.id}">${buildStatusOptions(o.status)}</select></td>
          <td>${escapeHtml(o.payment_method || '')}</td>
          <td><div class="description-preview">${escapeHtml(previewText(o.description))}</div></td>
          <td class="row-actions">
            <button class="btn-secondary btn-sm" data-export-pdf="${o.id}">Export PDF</button>
            <button class="danger btn-sm" data-delete="${o.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');

    rowsEl.querySelectorAll('[data-open-order]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
    });

    rowsEl.querySelectorAll('[data-open-person]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openPerson) }));
    });

    rowsEl.querySelectorAll('.quick-status').forEach((select) => {
      const order = orders.find((o) => o.id === Number(select.dataset.quickStatus));
      select.value = order.status;
      select.addEventListener('change', async () => {
        await window.api.order.update(order.id, { status: select.value });
        await load();
      });
    });

    rowsEl.querySelectorAll('[data-export-pdf]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const savedPath = await window.api.order.exportPdf(Number(btn.dataset.exportPdf));
          if (savedPath) alert(`Saved PDF to:\n${savedPath}`);
        } catch (err) {
          alert(`Failed to export PDF: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    rowsEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this order?')) return;
        await window.api.order.delete(Number(btn.dataset.delete));
        await load();
      });
    });
  }

  filterSelect.addEventListener('change', render);
  sortSelect.addEventListener('change', render);

  load();
}
