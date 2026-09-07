// Analytics: rankings and breakdowns ("how's the business doing"), as
// opposed to dashboard.js's "at a glance while working" operational
// status (open orders, due dates). No overlap in purpose -- this page
// adds nothing dashboard.js already shows.

import { escapeHtml, formatMoney, loadingHtml, priorityBadgeHtml } from '../helpers.js';

const PRIORITY_LABELS = { vip: 'VIP', normal: 'Normal', low: 'Low priority' };

export function renderAnalyticsView(container, { navigate }) {
  container.innerHTML = `
    <h1>Analytics</h1>

    <div class="income-summary-grid" id="analytics-overview">${loadingHtml()}</div>

    <section class="card">
      <h2>Top 5 spenders</h2>
      <div id="top-spenders-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Revenue by priority</h2>
      <div id="revenue-priority-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Top content</h2>
      <div class="analytics-columns" id="top-content-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Revenue by platform</h2>
      <p class="hint">Orders with no linked platform account aren't attributable to one, so they're excluded here.</p>
      <div id="revenue-platform-body">${loadingHtml()}</div>
    </section>

    <section class="card">
      <h2>Revenue trend (last 12 months)</h2>
      <div id="revenue-trend-body">${loadingHtml()}</div>
    </section>
  `;

  init();

  async function init() {
    const [overview, topSpenders, byPriority, contentItems, byPlatform, trend] = await Promise.all([
      window.api.analytics.getOverview(),
      window.api.analytics.getTopSpenders(5),
      window.api.analytics.getRevenueByPriority(),
      window.api.contentItem.listAll(),
      window.api.analytics.getRevenueByPlatform(),
      window.api.analytics.getMonthlyRevenueTrend(12),
    ]);

    renderOverview(overview);
    renderTopSpenders(topSpenders);
    renderRevenueByPriority(byPriority);
    renderTopContent(contentItems);
    renderRevenueByPlatform(byPlatform);
    renderTrend(trend);
  }

  function renderOverview(overview) {
    container.querySelector('#analytics-overview').innerHTML = `
      <div class="income-stat">
        <div class="income-stat-label">Clients</div>
        <div class="income-stat-value">${overview.clientCount}</div>
      </div>
      <div class="income-stat">
        <div class="income-stat-label">All-time revenue</div>
        <div class="income-stat-value">${formatMoney(overview.allTimeRevenueCents)}</div>
      </div>
      <div class="income-stat">
        <div class="income-stat-label">Confirmed orders</div>
        <div class="income-stat-value">${overview.confirmedOrderCount}</div>
      </div>
      <div class="income-stat">
        <div class="income-stat-label">Average order</div>
        <div class="income-stat-value">${formatMoney(overview.averageOrderCents)}</div>
      </div>
    `;
  }

  function renderTopSpenders(spenders) {
    const body = container.querySelector('#top-spenders-body');
    if (spenders.length === 0) {
      body.innerHTML = '<p class="muted">No confirmed sales yet.</p>';
      return;
    }

    body.innerHTML = `
      <table class="data-table">
        <thead><tr><th>#</th><th>Client</th><th>Total spent</th></tr></thead>
        <tbody>
          ${spenders
            .map(
              (s, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>
                <button class="link-button" data-open-person="${s.id}">${escapeHtml(s.private_label)}</button>
                ${priorityBadgeHtml(s.priority)}
              </td>
              <td>${formatMoney(s.total_cents)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;

    body.querySelectorAll('[data-open-person]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openPerson) }));
    });
  }

  function renderRevenueByPriority(rows) {
    const body = container.querySelector('#revenue-priority-body');
    body.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Priority</th><th>Clients</th><th>Revenue</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${PRIORITY_LABELS[r.priority] || escapeHtml(r.priority)}</td>
              <td>${r.client_count}</td>
              <td>${formatMoney(r.total_cents)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderTopContent(contentItems) {
    const body = container.querySelector('#top-content-body');
    if (contentItems.length === 0) {
      body.innerHTML = '<p class="muted">No content items yet.</p>';
      return;
    }

    const byRevenue = [...contentItems].sort((a, b) => b.revenue_cents - a.revenue_cents).slice(0, 5);
    const bySales = [...contentItems].sort((a, b) => b.sale_count - a.sale_count).slice(0, 5);

    const renderList = (items, valueFn) =>
      items.length
        ? `<ol class="analytics-ranked-list">${items
            .map((item) => `<li><button class="link-button" data-open-content="${item.id}">${escapeHtml(item.title)}</button> -- ${valueFn(item)}</li>`)
            .join('')}</ol>`
        : '<p class="muted">Nothing yet.</p>';

    body.innerHTML = `
      <div>
        <h3>By revenue</h3>
        ${renderList(byRevenue, (item) => formatMoney(item.revenue_cents))}
      </div>
      <div>
        <h3>By sales</h3>
        ${renderList(bySales, (item) => `${item.sale_count} sale${item.sale_count === 1 ? '' : 's'}`)}
      </div>
    `;

    body.querySelectorAll('[data-open-content]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('contentDetail', { contentItemId: Number(btn.dataset.openContent) }));
    });
  }

  function renderRevenueByPlatform(rows) {
    const body = container.querySelector('#revenue-platform-body');
    if (rows.length === 0) {
      body.innerHTML = '<p class="muted">No confirmed sales linked to a platform account yet.</p>';
      return;
    }

    body.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Platform</th><th>Orders</th><th>Revenue</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${escapeHtml(r.platform_name)}</td>
              <td>${r.order_count}</td>
              <td>${formatMoney(r.total_cents)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderTrend(months) {
    const body = container.querySelector('#revenue-trend-body');
    const total = months.reduce((sum, m) => sum + m.total_cents, 0);
    if (total === 0) {
      body.innerHTML = '<p class="muted">Not enough data yet.</p>';
      return;
    }
    body.innerHTML = buildTrendChartSvg(months);
  }

  // A dozen <rect> bars scaled to the largest month -- no charting
  // library needed for this. var(--accent) keeps it theme-aware, same
  // "color via CSS variable" approach calendar.js already uses for
  // FullCalendar event colors.
  function buildTrendChartSvg(months) {
    const width = 720;
    const height = 180;
    const barGap = 6;
    const barWidth = width / months.length - barGap;
    const maxCents = Math.max(...months.map((m) => m.total_cents), 1);

    const bars = months
      .map((m, i) => {
        const barHeight = Math.max((m.total_cents / maxCents) * (height - 24), m.total_cents > 0 ? 2 : 0);
        const x = i * (barWidth + barGap);
        const y = height - 24 - barHeight;
        const label = formatMonthLabel(m.period);
        return `
          <g>
            <title>${escapeHtml(label)}: ${escapeHtml(formatMoney(m.total_cents))}</title>
            <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--accent)" rx="2" />
            <text x="${x + barWidth / 2}" y="${height - 6}" text-anchor="middle" class="revenue-trend-label">${escapeHtml(label)}</text>
          </g>`;
      })
      .join('');

    return `<svg class="revenue-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly revenue trend">${bars}</svg>`;
  }

  // 'YYYY-MM' -> short month abbreviation, e.g. "Jan". Display only --
  // no timezone-sensitive math happening here (see helpers.js's own
  // notes on where that actually matters in this codebase).
  function formatMonthLabel(period) {
    const date = new Date(`${period}-01T00:00:00`);
    if (Number.isNaN(date.getTime())) return period;
    return date.toLocaleString(undefined, { month: 'short' });
  }
}
