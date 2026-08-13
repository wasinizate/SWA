// "Due today / missed / due soon" digest, shown once each time the app
// is unlocked (see shell.js's renderShell()) -- a guaranteed-to-work
// complement to the desktop popup reminders in
// src/main/reminders/reminderScheduler.js, since this is just app UI and
// doesn't depend on whether the OS actually displays notifications
// (unconfirmed in some environments -- see README).

import { escapeHtml } from './helpers.js';

export async function maybeShowDueDateSummary(navigate) {
  const config = await window.api.settings.getOrderDueReminderConfig();
  if (!config || !config.showSummaryOnOpen) return;

  const { missed, dueToday, dueSoon } = await window.api.order.getDueDateSummary();
  if (missed.length === 0 && dueToday.length === 0 && dueSoon.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Order due dates</h2>
      ${renderBucket('Missed', missed, 'danger')}
      ${renderBucket('Due today', dueToday, 'amber')}
      ${renderBucket('Due soon', dueSoon, 'muted')}
      <p class="hint">Adjust or turn this off under Settings &rarr; Order due date reminders.</p>
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="due-summary-close">Close</button>
      </div>
    </div>
  `;

  function closeModal() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(event) {
    if (event.key === 'Escape') closeModal();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener('keydown', onKeydown);

  overlay.querySelector('#due-summary-close').addEventListener('click', closeModal);

  overlay.querySelectorAll('[data-open-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal();
      navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) });
    });
  });

  document.body.appendChild(overlay);
}

function renderBucket(title, orders, severity) {
  if (orders.length === 0) return '';
  return `
    <div class="due-summary-bucket due-summary-${severity}">
      <h3>${escapeHtml(title)} (${orders.length})</h3>
      <ul class="due-summary-list">
        ${orders
          .map(
            (o) => `
            <li>
              <button type="button" class="link-button" data-open-order="${o.id}">
                Order #${o.id} — ${escapeHtml(o.person_label)} — ${o.delivery_due_date}${o.delivery_due_time ? ` ${escapeHtml(o.delivery_due_time)}` : ''}
              </button>
            </li>`
          )
          .join('')}
      </ul>
    </div>
  `;
}
