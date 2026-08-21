'use strict';

// Repository layer for `orders`. The only place that writes raw SQL for
// it.

const crypto = require('crypto');
const { getDb } = require('../connection');

function listByPerson(personId) {
  return getDb()
    .prepare('SELECT * FROM orders WHERE person_id = ? ORDER BY date_paid DESC, created_at DESC')
    .all(personId);
}

// Used by the global "All Orders" view. Joins in the person's label so the
// list is readable without a separate lookup per row.
function listAll() {
  return getDb()
    .prepare(
      `SELECT orders.*, persons.private_label AS person_label
       FROM orders
       JOIN persons ON persons.id = orders.person_id
       ORDER BY orders.date_paid DESC, orders.created_at DESC`
    )
    .all();
}

function get(id) {
  return getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function create({
  personId,
  platformAccountId = null,
  amountCents = 0,
  currency = 'USD',
  datePaid = null,
  paymentMethod = '',
  description = '',
  status = 'pending',
  deliveryDueDate = null,
  deliveryDueTime = null,
  // Only ever passed by applyImport.js -- preserves the *source*
  // order's external_id on the newly-created local row, so re-importing
  // the same export file later is recognized as a dupe via
  // getByExternalId() instead of generating a fresh id and duplicating.
  // Every other caller leaves this null and gets one lazily later (see
  // ensureExternalId()) if/when the order is itself exported.
  externalId = null,
}) {
  if (!personId) throw new Error('personId is required.');

  const result = getDb()
    .prepare(
      `INSERT INTO orders (
         person_id, platform_account_id, amount_cents, currency,
         date_paid, payment_method, description, status, delivery_due_date, delivery_due_time, external_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      personId,
      platformAccountId,
      amountCents,
      currency,
      datePaid,
      paymentMethod,
      description,
      status,
      deliveryDueDate,
      deliveryDueTime,
      externalId
    );
  return get(result.lastInsertRowid);
}

function update(id, fields) {
  const existing = get(id);
  if (!existing) throw new Error(`Order ${id} not found.`);

  const merged = { ...toCamel(existing), ...fields };
  getDb()
    .prepare(
      `UPDATE orders SET
         platform_account_id = ?, amount_cents = ?, currency = ?, date_paid = ?,
         payment_method = ?, description = ?, status = ?, delivery_due_date = ?, delivery_due_time = ?,
         feedback_notes = ?, would_repeat = ?
       WHERE id = ?`
    )
    .run(
      merged.platformAccountId,
      merged.amountCents,
      merged.currency,
      merged.datePaid,
      merged.paymentMethod,
      merged.description,
      merged.status,
      merged.deliveryDueDate,
      merged.deliveryDueTime,
      merged.feedbackNotes,
      merged.wouldRepeat,
      id
    );
  return get(id);
}

function remove(id) {
  getDb().prepare('DELETE FROM orders WHERE id = ?').run(id);
}

// Every order with a delivery due date set, for the Calendar view to
// display automatically -- no separate calendar_events row needed, so
// the calendar always reflects the order's actual due date with nothing
// to keep in sync. Cancelled orders are excluded, same reasoning as
// getTotalsByPerson() below: no longer relevant to anyone's schedule.
function listWithDeliveryDueDates() {
  return getDb()
    .prepare(
      `SELECT orders.id, orders.person_id, persons.private_label AS person_label,
              orders.delivery_due_date, orders.delivery_due_time, orders.status, orders.due_reminder_notified_on
       FROM orders
       JOIN persons ON persons.id = orders.person_id
       WHERE orders.delivery_due_date IS NOT NULL AND orders.status != 'cancelled'`
    )
    .all();
}

// Three buckets for the "due date digest" shown once per unlock (see
// src/renderer/dueDateSummary.js): overdue-and-still-open, due today,
// and due within `daysAhead` days. Cancelled orders never count; missed
// additionally excludes completed orders, since a finished order isn't
// "missed" just because it finished after its due date.
function getDueDateSummary(daysAhead) {
  const db = getDb();
  const base = `
    SELECT orders.id, orders.person_id, persons.private_label AS person_label,
           orders.delivery_due_date, orders.delivery_due_time, orders.status
    FROM orders
    JOIN persons ON persons.id = orders.person_id
    WHERE orders.delivery_due_date IS NOT NULL AND orders.status != 'cancelled'
  `;

  const missed = db
    .prepare(`${base} AND orders.delivery_due_date < date('now', 'localtime') AND orders.status != 'completed' ORDER BY orders.delivery_due_date ASC`)
    .all();

  const dueToday = db
    .prepare(`${base} AND orders.delivery_due_date = date('now', 'localtime') ORDER BY orders.delivery_due_time ASC`)
    .all();

  const dueSoon = db
    .prepare(
      `${base} AND orders.delivery_due_date > date('now', 'localtime')
       AND orders.delivery_due_date <= date('now', 'localtime', '+' || ? || ' days')
       ORDER BY orders.delivery_due_date ASC`
    )
    .all(daysAhead);

  return { missed, dueToday, dueSoon };
}

// Records that a due-date reminder notification was shown for this order
// on `dateString` (YYYY-MM-DD, the app's local date) -- see
// src/main/reminders/reminderScheduler.js, which uses this to fire at
// most once per day.
function markDueReminderNotified(orderId, dateString) {
  getDb().prepare('UPDATE orders SET due_reminder_notified_on = ? WHERE id = ?').run(dateString, orderId);
}

// Aggregated purchase totals for one person, used by the "Totals" card in
// the Person detail view. Cancelled orders and orders with no date_paid
// (i.e. money that hasn't actually landed) are excluded -- this reflects
// confirmed payments, not the full order book.
function getTotalsByPerson(personId) {
  const db = getDb();
  const where = `person_id = ? AND date_paid IS NOT NULL AND status != 'cancelled'`;

  const allTimeCents = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total_cents FROM orders WHERE ${where}`)
    .get(personId).total_cents;

  const byYear = db
    .prepare(
      `SELECT strftime('%Y', date_paid) AS period, SUM(amount_cents) AS total_cents
       FROM orders WHERE ${where}
       GROUP BY period ORDER BY period DESC`
    )
    .all(personId);

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', date_paid) AS period, SUM(amount_cents) AS total_cents
       FROM orders WHERE ${where}
       GROUP BY period ORDER BY period DESC`
    )
    .all(personId);

  return { allTimeCents, byYear, byMonth };
}

// Money expected but not yet confirmed -- orders that haven't been paid
// yet and aren't cancelled. A companion to getTotalsByPerson()/
// getTotalsAll() (which only count confirmed, date_paid money) for the
// Expenses page's "slated income" card. Returns the underlying orders
// too (not just the sum) so the UI can show which ones make it up,
// same join shape as listAll().
function getSlatedIncomeTotals() {
  const db = getDb();
  const where = `date_paid IS NULL AND status != 'cancelled'`;

  const totalCents = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total_cents FROM orders WHERE ${where}`)
    .get().total_cents;

  const orders = db
    .prepare(
      `SELECT orders.id, orders.person_id, persons.private_label AS person_label,
              orders.amount_cents, orders.currency, orders.status, orders.delivery_due_date
       FROM orders
       JOIN persons ON persons.id = orders.person_id
       WHERE ${where}
       ORDER BY orders.delivery_due_date IS NULL, orders.delivery_due_date ASC, orders.created_at DESC`
    )
    .all();

  return { totalCents, orders };
}

// Count of orders still "in flight" -- same NOT IN ('completed','cancelled')
// definition getDueDateSummary() already uses to decide what's still
// relevant to a due-date digest. Used by the Dashboard's "Open orders"
// stat card.
function getOpenOrderCount() {
  return getDb()
    .prepare(`SELECT COUNT(*) AS count FROM orders WHERE status NOT IN ('completed', 'cancelled')`)
    .get().count;
}

// Last order date per person (any status -- even an unpaid/pending order
// still counts as recent contact), for the Clients list's/Dashboard's
// "haven't heard from" tracking. Grouped into a plain map in JS (no
// array-agg in better-sqlite3, same approach as tag.js's
// listGroupedByPerson()) -- a person with zero orders simply has no key
// here, rather than a null entry.
function listLastOrderDateByPerson() {
  const rows = getDb().prepare('SELECT person_id, MAX(created_at) AS last_order_at FROM orders GROUP BY person_id').all();
  const map = {};
  for (const row of rows) map[row.person_id] = row.last_order_at;
  return map;
}

// Same all-time/by-year/by-month shape as getTotalsByPerson(), but
// across every person -- needed by the Expenses page's business-wide
// "confirmed income" figure, which has no single person to scope to.
function getTotalsAll() {
  const db = getDb();
  const where = `date_paid IS NOT NULL AND status != 'cancelled'`;

  const allTimeCents = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total_cents FROM orders WHERE ${where}`).get()
    .total_cents;

  const byYear = db
    .prepare(
      `SELECT strftime('%Y', date_paid) AS period, SUM(amount_cents) AS total_cents
       FROM orders WHERE ${where}
       GROUP BY period ORDER BY period DESC`
    )
    .all();

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', date_paid) AS period, SUM(amount_cents) AS total_cents
       FROM orders WHERE ${where}
       GROUP BY period ORDER BY period DESC`
    )
    .all();

  return { allTimeCents, byYear, byMonth };
}

// Cross-instance export/import support (see src/main/dataExchange/) --
// same pair as person.js's getByExternalId()/ensureExternalId(), for
// deduping an order that's already been imported once before.
function getByExternalId(externalId) {
  return getDb().prepare('SELECT * FROM orders WHERE external_id = ?').get(externalId);
}

function ensureExternalId(id) {
  const existing = get(id);
  if (!existing) throw new Error(`Order ${id} not found.`);
  if (existing.external_id) return existing.external_id;

  const externalId = crypto.randomUUID();
  getDb().prepare('UPDATE orders SET external_id = ? WHERE id = ?').run(externalId, id);
  return externalId;
}

// Converts a raw (snake_case) DB row into the camelCase shape used by
// create()/update() inputs, so update() can merge a partial patch onto the
// existing row without repeating every field name twice.
function toCamel(row) {
  return {
    platformAccountId: row.platform_account_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    datePaid: row.date_paid,
    paymentMethod: row.payment_method,
    description: row.description,
    status: row.status,
    deliveryDueDate: row.delivery_due_date,
    deliveryDueTime: row.delivery_due_time,
    feedbackNotes: row.feedback_notes,
    wouldRepeat: row.would_repeat,
  };
}

module.exports = {
  listByPerson,
  listAll,
  get,
  create,
  update,
  remove,
  getTotalsByPerson,
  listWithDeliveryDueDates,
  markDueReminderNotified,
  getDueDateSummary,
  getOpenOrderCount,
  listLastOrderDateByPerson,
  getSlatedIncomeTotals,
  getTotalsAll,
  getByExternalId,
  ensureExternalId,
};
