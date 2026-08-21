'use strict';

// Repository layer for `price_templates`/`price_template_items` (see
// 0010_price_templates.sql). The only place that writes raw SQL for
// either.

const { getDb } = require('../connection');

function listItemsForTemplate(templateId) {
  return getDb()
    .prepare(
      `SELECT id, label, rate_cents, default_qty
       FROM price_template_items
       WHERE price_template_id = ?
       ORDER BY sort_order ASC, id ASC`
    )
    .all(templateId);
}

function get(id) {
  const template = getDb().prepare('SELECT * FROM price_templates WHERE id = ?').get(id);
  if (!template) return null;
  return { ...template, items: listItemsForTemplate(id) };
}

// One query for every template's items at once (grouped in JS --
// better-sqlite3 has no array-agg, same approach as tag.js's
// listGroupedByPerson()), used so the Settings list and the
// calculator's "Load template" dropdown aren't N+1 queries.
function listAll() {
  const templates = getDb()
    .prepare('SELECT * FROM price_templates ORDER BY platform_name COLLATE NOCASE, label COLLATE NOCASE')
    .all();
  if (templates.length === 0) return [];

  const items = getDb()
    .prepare('SELECT * FROM price_template_items ORDER BY price_template_id, sort_order ASC, id ASC')
    .all();

  const itemsByTemplate = {};
  for (const item of items) {
    if (!itemsByTemplate[item.price_template_id]) itemsByTemplate[item.price_template_id] = [];
    itemsByTemplate[item.price_template_id].push(item);
  }

  return templates.map((t) => ({ ...t, items: itemsByTemplate[t.id] || [] }));
}

function insertItems(db, templateId, items) {
  const insert = db.prepare(
    'INSERT INTO price_template_items (price_template_id, label, rate_cents, default_qty, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  items.forEach((item, index) => {
    insert.run(templateId, (item.label || '').trim(), Math.round(item.rateCents) || 0, Number(item.defaultQty) || 0, index);
  });
}

function create({ platformName, label, defaultDiscountPercent = 0, items = [] }) {
  if (!platformName || !platformName.trim()) throw new Error('platformName is required.');
  if (!label || !label.trim()) throw new Error('label is required.');

  const db = getDb();
  // Wrapped in a transaction (same "multi-statement write" pattern
  // migrate.js's applyMigration already uses) so a template row is never
  // left behind with no items, or vice versa, if something throws
  // partway through.
  const createTxn = db.transaction(() => {
    const result = db
      .prepare('INSERT INTO price_templates (platform_name, label, default_discount_percent) VALUES (?, ?, ?)')
      .run(platformName.trim(), label.trim(), Number(defaultDiscountPercent) || 0);
    insertItems(db, result.lastInsertRowid, items);
    return result.lastInsertRowid;
  });

  return get(createTxn());
}

function update(id, { platformName, label, defaultDiscountPercent, items }) {
  const existing = get(id);
  if (!existing) throw new Error(`Price template ${id} not found.`);

  const db = getDb();
  const updateTxn = db.transaction(() => {
    db.prepare('UPDATE price_templates SET platform_name = ?, label = ?, default_discount_percent = ? WHERE id = ?').run(
      platformName !== undefined ? platformName.trim() : existing.platform_name,
      label !== undefined ? label.trim() : existing.label,
      defaultDiscountPercent !== undefined ? Number(defaultDiscountPercent) || 0 : existing.default_discount_percent,
      id
    );

    // Full replace (delete-all, reinsert) rather than a diff -- the
    // editor always sends the complete item list, same "whole set at
    // once" shape as the rows themselves in the calculator.
    if (items !== undefined) {
      db.prepare('DELETE FROM price_template_items WHERE price_template_id = ?').run(id);
      insertItems(db, id, items);
    }
  });
  updateTxn();

  return get(id);
}

function remove(id) {
  // ON DELETE CASCADE (declared in the schema) takes care of that
  // template's items automatically.
  getDb().prepare('DELETE FROM price_templates WHERE id = ?').run(id);
}

module.exports = { listAll, get, create, update, remove };
