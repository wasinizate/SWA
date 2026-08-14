'use strict';

// Repository layer for manually-entered platform pay-statement totals
// (see 0007_expenses_and_income.sql). The only place that writes raw SQL
// for `income_statements`.

const { getDb } = require('../connection');

function listAll() {
  return getDb().prepare('SELECT * FROM income_statements ORDER BY period_start DESC, created_at DESC').all();
}

function get(id) {
  return getDb().prepare('SELECT * FROM income_statements WHERE id = ?').get(id);
}

function create({ periodStart, periodEnd, platform = '', currency = 'USD', grossCents = 0, feesCents = 0, netCents = 0, notes = '' }) {
  if (!periodStart) throw new Error('periodStart is required.');
  if (!periodEnd) throw new Error('periodEnd is required.');

  const result = getDb()
    .prepare(
      `INSERT INTO income_statements (period_start, period_end, platform, currency, gross_cents, fees_cents, net_cents, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(periodStart, periodEnd, platform, currency, grossCents, feesCents, netCents, notes);
  return get(result.lastInsertRowid);
}

function update(id, fields) {
  const existing = get(id);
  if (!existing) throw new Error(`Income statement ${id} not found.`);

  const merged = {
    periodStart: fields.periodStart !== undefined ? fields.periodStart : existing.period_start,
    periodEnd: fields.periodEnd !== undefined ? fields.periodEnd : existing.period_end,
    platform: fields.platform !== undefined ? fields.platform : existing.platform,
    currency: fields.currency !== undefined ? fields.currency : existing.currency,
    grossCents: fields.grossCents !== undefined ? fields.grossCents : existing.gross_cents,
    feesCents: fields.feesCents !== undefined ? fields.feesCents : existing.fees_cents,
    netCents: fields.netCents !== undefined ? fields.netCents : existing.net_cents,
    notes: fields.notes !== undefined ? fields.notes : existing.notes,
  };

  getDb()
    .prepare(
      `UPDATE income_statements SET
         period_start = ?, period_end = ?, platform = ?, currency = ?, gross_cents = ?, fees_cents = ?, net_cents = ?, notes = ?
       WHERE id = ?`
    )
    .run(
      merged.periodStart,
      merged.periodEnd,
      merged.platform,
      merged.currency,
      merged.grossCents,
      merged.feesCents,
      merged.netCents,
      merged.notes,
      id
    );
  return get(id);
}

function remove(id) {
  // ON DELETE CASCADE (declared in the schema) takes care of that
  // statement's attachments automatically.
  getDb().prepare('DELETE FROM income_statements WHERE id = ?').run(id);
}

// Aggregated totals for the Expenses page's summary card -- net_cents is
// what actually landed after platform fees, so that's what's summed
// (mirrors how order.js's totals exclude cancelled/unpaid orders: only
// count money that's actually confirmed).
function getTotals() {
  const db = getDb();

  const allTimeCents = db.prepare('SELECT COALESCE(SUM(net_cents), 0) AS total_cents FROM income_statements').get().total_cents;

  const byYear = db
    .prepare(
      `SELECT strftime('%Y', period_start) AS period, SUM(net_cents) AS total_cents
       FROM income_statements GROUP BY period ORDER BY period DESC`
    )
    .all();

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', period_start) AS period, SUM(net_cents) AS total_cents
       FROM income_statements GROUP BY period ORDER BY period DESC`
    )
    .all();

  return { allTimeCents, byYear, byMonth };
}

module.exports = { listAll, get, create, update, remove, getTotals };
