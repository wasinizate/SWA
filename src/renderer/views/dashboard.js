// Dashboard: an at-a-glance view of clients, open orders, upcoming due
// dates, and income. Deliberately reuses the exact same repository calls
// the Clients/Orders/Expenses pages and the unlock-time due-date popup
// already make (getOpenOrderCount, getDueDateSummary, getTotalsAll,
// getSlatedIncomeTotals) rather than recomputing any of it independently
// -- so the numbers shown here can never drift from what those pages show.
// Also hosts a small freeform notes scratchpad, backed by one more
// app_settings key (see getDashboardNote/setDashboardNote in
// src/main/db/repositories/settings.js) -- same key/value pattern already
// used there for the theme and auto-lock settings.

import { formatMoney, loadingHtml, daysSince } from '../helpers.js';
import { showToast } from '../toast.js';
import { renderBucket } from '../dueDateSummary.js';

export function renderDashboardView(container, { navigate }) {
  container.innerHTML = `
    <h1>Dashboard</h1>

    <div class="income-summary-grid" id="dashboard-stats">${loadingHtml()}</div>

    <section class="card">
      <h2>Due dates</h2>
      <div id="dashboard-due-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Notes</h2>
      <p class="hint">A scratchpad for anything worth remembering -- not tied to any client or order.</p>
      <textarea id="dashboard-note" rows="5"></textarea>
      <div class="form-actions">
        <button type="button" id="dashboard-note-save">Save</button>
      </div>
    </section>
  `;

  init();

  async function init() {
    const [people, openOrderCount, dueSummary, totalsAll, slated, note, lastOrderByPerson, quietThresholdDays, syncStatus] = await Promise.all([
      window.api.person.listAll(),
      window.api.order.getOpenOrderCount(),
      window.api.order.getDueDateSummary(),
      window.api.order.getTotalsAll(),
      window.api.order.getSlatedIncomeTotals(),
      window.api.settings.getDashboardNote(),
      window.api.order.listLastOrderDateByPerson(),
      window.api.settings.getQuietClientThresholdDays(),
      window.api.sync.getStatus(),
    ]);

    // A client with zero orders was never really "heard from" to begin
    // with, so only someone present in lastOrderByPerson (has ordered at
    // least once) and past the threshold counts as quiet -- same
    // definition people.js's own quiet-only filter uses.
    const quietClientCount = people.filter((p) => {
      const days = daysSince(lastOrderByPerson[p.id]);
      return days !== null && days >= (quietThresholdDays ?? 30);
    }).length;

    renderStats({ clientCount: people.length, openOrderCount, totalsAll, slated, quietClientCount, pendingSyncCount: syncStatus.pendingCount });
    renderDue(dueSummary);
    container.querySelector('#dashboard-note').value = note ?? '';
  }

  function renderStats({ clientCount, openOrderCount, totalsAll, slated, quietClientCount, pendingSyncCount }) {
    // 'YYYY-MM' in UTC, matching the strftime('%Y-%m', date_paid) grouping
    // getTotalsAll() uses server-side (no 'localtime' modifier there) --
    // using the browser's local month here would occasionally disagree
    // with which bucket a late-month order landed in. See CLAUDE.md's
    // note on date/timezone bugs in this codebase.
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const thisMonth = totalsAll.byMonth.find((m) => m.period === currentPeriod);
    const thisMonthCents = thisMonth ? thisMonth.total_cents : 0;

    const statsEl = container.querySelector('#dashboard-stats');
    statsEl.innerHTML = `
      <button type="button" class="income-stat stat-clickable" id="stat-clients">
        <div class="income-stat-label">Clients</div>
        <div class="income-stat-value">${clientCount}</div>
      </button>
      <button type="button" class="income-stat stat-clickable" id="stat-open-orders">
        <div class="income-stat-label">Open orders</div>
        <div class="income-stat-value">${openOrderCount}</div>
      </button>
      <button type="button" class="income-stat stat-clickable" id="stat-month-income">
        <div class="income-stat-label">This month's income</div>
        <div class="income-stat-value">${formatMoney(thisMonthCents)}</div>
      </button>
      <button type="button" class="income-stat stat-clickable" id="stat-slated">
        <div class="income-stat-label">Expected (unpaid)</div>
        <div class="income-stat-value">${formatMoney(slated.totalCents)}</div>
      </button>
      <button type="button" class="income-stat stat-clickable" id="stat-quiet-clients">
        <div class="income-stat-label">Quiet clients</div>
        <div class="income-stat-value">${quietClientCount}</div>
      </button>
      <button type="button" class="income-stat stat-clickable" id="stat-pending-sync">
        <div class="income-stat-label">Pending sync updates</div>
        <div class="income-stat-value">${pendingSyncCount}</div>
      </button>
    `;

    // Each stat doubles as a shortcut into the page that actually owns
    // that data -- "Open orders" jumps to the full Orders list rather
    // than a filtered one, since its 3-status definition (pending/
    // in_progress/on_hold) doesn't map onto that page's single-select
    // status filter.
    statsEl.querySelector('#stat-clients').addEventListener('click', () => navigate('people'));
    statsEl.querySelector('#stat-open-orders').addEventListener('click', () => navigate('orders'));
    statsEl.querySelector('#stat-month-income').addEventListener('click', () => navigate('expenses'));
    statsEl.querySelector('#stat-slated').addEventListener('click', () => navigate('expenses'));
    statsEl.querySelector('#stat-quiet-clients').addEventListener('click', () => navigate('people', { quietOnly: true }));
    statsEl.querySelector('#stat-pending-sync').addEventListener('click', () => navigate('settings'));
  }

  function renderDue({ missed, dueToday, dueSoon }) {
    const dueBody = container.querySelector('#dashboard-due-body');
    if (missed.length === 0 && dueToday.length === 0 && dueSoon.length === 0) {
      dueBody.innerHTML = '<p class="muted">Nothing due or overdue right now.</p>';
      return;
    }

    dueBody.innerHTML = `
      ${renderBucket('Missed', missed, 'danger')}
      ${renderBucket('Due today', dueToday, 'amber')}
      ${renderBucket('Due soon', dueSoon, 'muted')}
    `;

    dueBody.querySelectorAll('[data-open-order]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
    });
  }

  container.querySelector('#dashboard-note-save').addEventListener('click', async () => {
    await window.api.settings.setDashboardNote(container.querySelector('#dashboard-note').value);
    showToast('Saved.');
  });
}
