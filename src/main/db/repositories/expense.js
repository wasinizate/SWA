'use strict';

// Repository layer for the expense ledger (see 0007_expenses_and_income.sql).
// The only place that writes raw SQL for `expenses`.

const { getDb } = require('../connection');

function listAll() {
  return getDb().prepare('SELECT * FROM expenses ORDER BY date DESC, created_at DESC').all();
}

function get(id) {
  return getDb().prepare('SELECT * FROM expenses WHERE id = ?').get(id);
}

function create({ date, amountCents = 0, currency = 'USD', category = '', description = '' }) {
  if (!date) throw new Error('date is required.');

  const result = getDb()
    .prepare(
      `INSERT INTO expenses (date, amount_cents, currency, category, description)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(date, amountCents, currency, category, description);
  return get(result.lastInsertRowid);
}

function update(id, fields) {
  const existing = get(id);
  if (!existing) throw new Error(`Expense ${id} not found.`);

  const merged = { ...toCamel(existing), ...fields };
  getDb()
    .prepare(
      `UPDATE expenses SET date = ?, amount_cents = ?, currency = ?, category = ?, description = ?
       WHERE id = ?`
    )
    .run(merged.date, merged.amountCents, merged.currency, merged.category, merged.description, id);
  return get(id);
}

function remove(id) {
  getDb().prepare('DELETE FROM expenses WHERE id = ?').run(id);
}

// Converts a raw (snake_case) DB row into the camelCase shape used by
// update()'s inputs, so it can merge a partial patch onto the existing
// row without repeating every field name twice -- same pattern as
// order.js's toCamel().
function toCamel(row) {
  return {
    date: row.date,
    amountCents: row.amount_cents,
    currency: row.currency,
    category: row.category,
    description: row.description,
  };
}

// Aggregated totals for the Expenses page's summary card -- same
// all-time/by-year/by-month shape as order.js's getTotalsByPerson(),
// plus a by-category breakdown (this table has no person to scope by,
// so category is the natural grouping instead).
function getTotals() {
  const db = getDb();

  const allTimeCents = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total_cents FROM expenses').get().total_cents;

  const byYear = db
    .prepare(
      `SELECT strftime('%Y', date) AS period, SUM(amount_cents) AS total_cents
       FROM expenses GROUP BY period ORDER BY period DESC`
    )
    .all();

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', date) AS period, SUM(amount_cents) AS total_cents
       FROM expenses GROUP BY period ORDER BY period DESC`
    )
    .all();

  const byCategory = db
    .prepare(
      `SELECT COALESCE(NULLIF(category, ''), '(uncategorized)') AS category, SUM(amount_cents) AS total_cents
       FROM expenses GROUP BY category ORDER BY total_cents DESC`
    )
    .all();

  return { allTimeCents, byYear, byMonth, byCategory };
}

module.exports = { listAll, get, create, update, remove, getTotals };
