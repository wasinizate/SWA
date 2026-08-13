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

  let allOrders = [];

  async function load() {
    allOrders = await window.api.order.listAll();
    render();
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
