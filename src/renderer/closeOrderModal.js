// Marking an order "Completed" via a quick-status dropdown (orders.js,
// personDetail.js) is meant to CLOSE it out -- not just relabel it. Every
// revenue figure in this app (Client value, Client totals, Analytics,
// platform-revenue-by-year) requires `date_paid` to be set, so this
// modal makes recording that an unavoidable, deliberate part of
// completing an order instead of an easy-to-miss confirm() popup that
// leaves it silently uncounted while still reading "Completed" in the
// table. Only shown when the order doesn't already have a payment date
// -- see helpers.js's needsPaymentDateBeforeClosing() -- if it does,
// there's nothing left to decide and the caller applies the status
// change directly.

import { openModal } from './modal.js';
import { formatMoney, toDateInputValue } from './helpers.js';

// `onClose(datePaid)` fires exactly once, only on an actual submit --
// dismissing the modal (Close button, backdrop click, Escape) never
// calls it, so the caller should already have reverted its <select>
// back to the order's current status *before* opening this, rather than
// waiting on a "the user cancelled" signal this modal doesn't send.
export function openCloseOrderModal({ order, onClose }) {
  const today = toDateInputValue(new Date().toISOString());

  openModal({
    title: `Close order #${order.id}`,
    render: (body, close) => {
      body.innerHTML = `
        <p class="hint">
          Marking this order Completed records it as paid -- every revenue total in this app
          (Client value, Client totals, Analytics, platform revenue) requires a payment date to count it.
          Amount: ${formatMoney(order.amount_cents, order.currency)}.
        </p>
        <form id="close-order-form">
          <label>Date paid <input type="date" id="close-order-date-paid" value="${today}" required /></label>
          <div class="form-actions">
            <button type="submit">Close order</button>
          </div>
        </form>
      `;

      body.querySelector('#close-order-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const datePaid = body.querySelector('#close-order-date-paid').value;
        if (!datePaid) return;
        close();
        onClose(datePaid);
      });
    },
  });
}
