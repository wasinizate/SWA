'use strict';

// Cross-cutting aggregate queries for the Analytics page -- no table of
// its own, same shape as search.js (composes queries across persons/
// orders/platform_accounts without owning any of them). Reuses other
// repositories' already-computed stats rather than re-deriving the
// "confirmed sale" definition a third time: content rankings come
// straight from contentItem.listAll()'s sale_count/revenue_cents, and
// the monthly trend/all-time total reuse order.js's getTotalsAll().

const { getDb } = require('../connection');
const orderRepo = require('./order');

// Same definition order.js's own getTotalsAll()/getTotalsByPerson()
// already use everywhere for "confirmed income": a real payment date,
// not cancelled.
const CONFIRMED_SALE_WHERE = `orders.date_paid IS NOT NULL AND orders.status != 'cancelled'`;

function getOverview() {
  const db = getDb();
  const clientCount = db.prepare('SELECT COUNT(*) AS count FROM persons').get().count;
  const confirmedOrderCount = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE ${CONFIRMED_SALE_WHERE}`).get().count;
  const allTimeRevenueCents = orderRepo.getTotalsAll().allTimeCents;
  const averageOrderCents = confirmedOrderCount > 0 ? Math.round(allTimeRevenueCents / confirmedOrderCount) : 0;

  return { clientCount, allTimeRevenueCents, confirmedOrderCount, averageOrderCents };
}

// Priority rides along so the results table can show a VIP badge inline
// (reuses the renderer's priorityBadgeHtml()).
function getTopSpenders(limit = 5) {
  return getDb()
    .prepare(
      `SELECT persons.id, persons.private_label, persons.priority,
              COALESCE(SUM(orders.amount_cents), 0) AS total_cents
       FROM persons
       JOIN orders ON orders.person_id = persons.id AND ${CONFIRMED_SALE_WHERE}
       GROUP BY persons.id
       ORDER BY total_cents DESC
       LIMIT ?`
    )
    .all(limit);
}

// LEFT JOIN from persons (not an inner join from orders) so a priority
// tier with zero revenue -- e.g. no VIPs marked yet -- still shows a
// $0/0-client row instead of silently disappearing.
function getRevenueByPriority() {
  return getDb()
    .prepare(
      `SELECT persons.priority,
              COUNT(DISTINCT persons.id) AS client_count,
              COALESCE(SUM(CASE WHEN ${CONFIRMED_SALE_WHERE} THEN orders.amount_cents END), 0) AS total_cents
       FROM persons
       LEFT JOIN orders ON orders.person_id = persons.id
       GROUP BY persons.priority
       ORDER BY total_cents DESC`
    )
    .all();
}

// Orders with no linked platform account are excluded -- can't
// attribute revenue to a platform without one (noted in the UI copy,
// not hidden silently). Platform names are free text, so grouping is
// case-insensitive: "OnlyFans" and "onlyfans" are one platform.
function getRevenueByPlatform() {
  return getDb()
    .prepare(
      `SELECT MIN(platform_accounts.platform_name) AS platform_name,
              COUNT(*) AS order_count,
              COALESCE(SUM(orders.amount_cents), 0) AS total_cents
       FROM orders
       JOIN platform_accounts ON platform_accounts.id = orders.platform_account_id
       WHERE ${CONFIRMED_SALE_WHERE}
       GROUP BY platform_accounts.platform_name COLLATE NOCASE
       ORDER BY total_cents DESC`
    )
    .all();
}

// The last `months` calendar months ending with the current (local) month,
// oldest first, with $0 for months that had no sales. (It used to take
// the most recent months that *had* revenue, so empty months vanished and
// bars from a year apart sat side by side as if consecutive.)
function getMonthlyRevenueTrend(months = 12) {
  const totals = new Map(orderRepo.getTotalsAll().byMonth.map((m) => [m.period, m.total_cents]));
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const trend = [];
  for (let back = months - 1; back >= 0; back--) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const period = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
    trend.push({ period, total_cents: totals.get(period) || 0 });
  }
  return trend;
}

module.exports = { getOverview, getTopSpenders, getRevenueByPriority, getRevenueByPlatform, getMonthlyRevenueTrend };
