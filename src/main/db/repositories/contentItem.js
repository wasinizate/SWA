'use strict';

// Repository layer for `content_items`/`content_item_tags`/
// `order_content_items` (see 0014_content_library.sql). The only place
// that writes raw SQL for any of the three.

const crypto = require('crypto');
const { getDb } = require('../connection');
const tagRepo = require('./tag');

// Orders that actually count as a sale -- confirmed payment, not
// cancelled. Same definition order.js's own getTotalsAll()/
// getTotalsByPerson() already use for "confirmed income", kept as one
// literal string here rather than importing order.js (no existing
// precedent in this codebase for one repository importing another's raw
// SQL fragment, and this is a two-line condition, not worth the coupling).
const CONFIRMED_SALE_WHERE = `orders.date_paid IS NOT NULL AND orders.status != 'cancelled'`;

// sale_count/revenue_cents ride along on every row -- see this module's
// top comment on the revenue approximation for bundled orders. One
// query, not N+1, same reasoning as tag.js's usage_count.
//
// revenue_cents prefers order_content_items.price_paid_cents (the
// per-item override set on the order -- see setPricePaid()) and only
// falls back to the order's full amount_cents when no override was
// recorded, which is what makes a bundled order's per-item revenue an
// approximation in the first place (contentLibrary.js's hint text
// explains this to the user). Recording price-paid on every bundled
// order's items is what actually fixes the approximation -- this query
// just prefers the real number wherever one exists.
function listAll() {
  return getDb()
    .prepare(
      `SELECT content_items.*,
              COUNT(DISTINCT CASE WHEN ${CONFIRMED_SALE_WHERE} THEN orders.id END) AS sale_count,
              COALESCE(SUM(CASE WHEN ${CONFIRMED_SALE_WHERE} THEN COALESCE(order_content_items.price_paid_cents, orders.amount_cents) END), 0) AS revenue_cents
       FROM content_items
       LEFT JOIN order_content_items ON order_content_items.content_item_id = content_items.id
       LEFT JOIN orders ON orders.id = order_content_items.order_id
       GROUP BY content_items.id
       ORDER BY content_items.title COLLATE NOCASE`
    )
    .all();
}

function get(id) {
  return getDb().prepare('SELECT * FROM content_items WHERE id = ?').get(id);
}

function create({ title, contentType = '', description = '', location = '', priceCents = 0 }) {
  if (!title || !title.trim()) throw new Error('title is required.');

  const result = getDb()
    .prepare('INSERT INTO content_items (title, content_type, description, location, price_cents) VALUES (?, ?, ?, ?, ?)')
    .run(title.trim(), contentType, description, location, Math.round(priceCents) || 0);
  return get(result.lastInsertRowid);
}

function update(id, { title, contentType, description, location, priceCents }) {
  const existing = get(id);
  if (!existing) throw new Error(`Content item ${id} not found.`);

  getDb()
    .prepare('UPDATE content_items SET title = ?, content_type = ?, description = ?, location = ?, price_cents = ? WHERE id = ?')
    .run(
      title !== undefined ? title.trim() : existing.title,
      contentType !== undefined ? contentType : existing.content_type,
      description !== undefined ? description : existing.description,
      location !== undefined ? location : existing.location,
      priceCents !== undefined ? Math.round(priceCents) || 0 : existing.price_cents,
      id
    );
  return get(id);
}

function remove(id) {
  // ON DELETE CASCADE (declared in the schema) takes care of
  // content_item_tags, order_content_items, and content_item_files
  // automatically.
  getDb().prepare('DELETE FROM content_items WHERE id = ?').run(id);
}

// ---- Media folder scanner (see 0015_content_scanning.sql and
// src/main/scanner/contentScanner.js) ----------------------------------

// Used to detect folders that disappeared since the last scan -- only a
// row that was *already* scanned can go missing (a manual item that was
// simply never matched isn't "missing", it's just still manual).
function listScanned() {
  return getDb().prepare('SELECT * FROM content_items WHERE is_scanned = 1').all();
}

// The scanner's location-matching lookup -- deliberately every item
// with a location set, scanned or manual, so a manually-created item
// whose Location a user points at a real folder gets *adopted*
// (markScanPresent) instead of the scanner creating a duplicate. See
// contentScanner.js's top comment for why matching is path-based.
function listWithLocation() {
  return getDb().prepare(`SELECT id, location, is_scanned FROM content_items WHERE location != ''`).all();
}

// Like create(), but for a row the scanner discovered rather than a
// user typing it in -- sets is_scanned/last_scanned_at, and never
// touches an existing row (see markScanPresent for that case).
function createScanned({ title, location, contentType = '' }) {
  const result = getDb()
    .prepare(
      `INSERT INTO content_items (title, content_type, location, is_scanned, last_scanned_at)
       VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    )
    .run(title, contentType, location);
  return get(result.lastInsertRowid);
}

// Also used to "adopt" an existing, previously-manual item whose
// location a user has just pointed at a real folder -- flips
// is_scanned on without touching title/content_type/description/price,
// none of which the scanner should ever overwrite once a user's set them.
function markScanPresent(id) {
  getDb()
    .prepare(
      `UPDATE content_items SET is_scanned = 1, folder_missing = 0, last_scanned_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    )
    .run(id);
}

function markScanMissing(id) {
  getDb().prepare('UPDATE content_items SET folder_missing = 1 WHERE id = ?').run(id);
}

// ---- Tags (reuses the shared `tags` table -- see tag.js) -----------------

function listTagsFor(contentItemId) {
  return getDb()
    .prepare(
      `SELECT tags.id, tags.label
       FROM content_item_tags
       JOIN tags ON tags.id = content_item_tags.tag_id
       WHERE content_item_tags.content_item_id = ?
       ORDER BY tags.label COLLATE NOCASE`
    )
    .all(contentItemId);
}

function addTag(contentItemId, label) {
  const tag = tagRepo.findOrCreateByLabel(label);
  getDb().prepare('INSERT OR IGNORE INTO content_item_tags (content_item_id, tag_id) VALUES (?, ?)').run(contentItemId, tag.id);
  return listTagsFor(contentItemId);
}

function removeTag(contentItemId, tagId) {
  getDb().prepare('DELETE FROM content_item_tags WHERE content_item_id = ? AND tag_id = ?').run(contentItemId, tagId);
  return listTagsFor(contentItemId);
}

// ---- Order linking ---------------------------------------------------

// content_items.price_cents (the item's own suggested price) rides
// along under its usual name; order_content_items.price_paid_cents is
// aliased alongside it so the "Content sold" card can show both --
// what's normally asked, and what this particular sale actually charged.
function listForOrder(orderId) {
  return getDb()
    .prepare(
      `SELECT content_items.*, order_content_items.price_paid_cents AS price_paid_cents
       FROM order_content_items
       JOIN content_items ON content_items.id = order_content_items.content_item_id
       WHERE order_content_items.order_id = ?
       ORDER BY content_items.title COLLATE NOCASE`
    )
    .all(orderId);
}

function addToOrder(orderId, contentItemId) {
  getDb().prepare('INSERT OR IGNORE INTO order_content_items (order_id, content_item_id) VALUES (?, ?)').run(orderId, contentItemId);
  return listForOrder(orderId);
}

function removeFromOrder(orderId, contentItemId) {
  getDb().prepare('DELETE FROM order_content_items WHERE order_id = ? AND content_item_id = ?').run(orderId, contentItemId);
  return listForOrder(orderId);
}

// Records what this content item actually sold for on this particular
// order -- an override for when a sale bundled several items together
// or ran at a discount off the item's own suggested price_cents.
// priceCentsOrNull === null clears the override back to "not recorded"
// (the UI falls back to showing the full order amount, same as before
// this column existed -- see listAll()'s revenue_cents comment).
function setPricePaid(orderId, contentItemId, priceCentsOrNull) {
  getDb()
    .prepare('UPDATE order_content_items SET price_paid_cents = ? WHERE order_id = ? AND content_item_id = ?')
    .run(priceCentsOrNull === null || priceCentsOrNull === undefined ? null : Math.round(priceCentsOrNull), orderId, contentItemId);
  return listForOrder(orderId);
}

// Finds a content item by title (case-insensitive) -- used when the
// order-detail picker's free-typed text matches an existing item
// exactly, same "reuse existing spelling" idea as tag.js's
// findOrCreateByLabel(), but content items are never auto-created from
// a typo the way tags are (a new content item needs more fields than a
// single label, so orderDetail.js's picker only ever attaches an
// *existing* one).
function findByTitle(title) {
  return getDb().prepare('SELECT * FROM content_items WHERE title = ? COLLATE NOCASE').get((title || '').trim());
}

// ---- Cross-instance portable identity (see
// 0017_content_item_external_id.sql) -- exact same shape as
// person.js's own getByExternalId()/ensureExternalId()/setExternalId(),
// so an order exported to another install can carry "this content item
// was part of the sale" as something portable instead of a local-only
// AUTOINCREMENT id. See dataExchange/applyImport.js for how these three
// get used together to resolve an incoming reference.

function getByExternalId(externalId) {
  return getDb().prepare('SELECT * FROM content_items WHERE external_id = ?').get(externalId);
}

// Generates and persists a UUID for this item if it doesn't already have
// one, then returns it either way. Called right before a content item is
// included in an order's export -- most items never get one, since most
// are never attached to an exported order.
function ensureExternalId(id) {
  const existing = get(id);
  if (!existing) throw new Error(`Content item ${id} not found.`);
  if (existing.external_id) return existing.external_id;

  const externalId = crypto.randomUUID();
  getDb().prepare('UPDATE content_items SET external_id = ? WHERE id = ?').run(externalId, id);
  return externalId;
}

// Unconditionally assigns an external_id -- used only when applyImport.js
// creates a brand-new local content item (a placeholder, title only) to
// represent an incoming reference it can't otherwise resolve, so the new
// row shares the *source's* external_id and a repeat import of the same
// order recognizes it directly next time, no content_item_external_links
// row even needed. ensureExternalId() above is for the opposite
// direction (mint a fresh id for a local item about to be exported) and
// never overwrites an existing one -- this always does, so it's kept
// separate.
function setExternalId(id, externalId) {
  getDb().prepare('UPDATE content_items SET external_id = ? WHERE id = ?').run(externalId, id);
}

// The buyer list for one item's own detail page -- same person-join
// shape as order.js's listAll(), scoped to confirmed sales only (see
// this module's top comment). price_paid_cents rides along so the
// detail page can show this item's actual per-sale price where one was
// recorded, instead of always showing the order's full (possibly
// bundled) amount -- see listAll()'s revenue_cents comment for the same
// reasoning applied to the aggregate.
function getSalesDetail(contentItemId) {
  return getDb()
    .prepare(
      `SELECT orders.id AS order_id, orders.person_id, persons.private_label AS person_label,
              orders.date_paid, orders.amount_cents, orders.currency,
              order_content_items.price_paid_cents AS price_paid_cents
       FROM order_content_items
       JOIN orders ON orders.id = order_content_items.order_id
       JOIN persons ON persons.id = orders.person_id
       WHERE order_content_items.content_item_id = ? AND ${CONFIRMED_SALE_WHERE}
       ORDER BY orders.date_paid DESC`
    )
    .all(contentItemId);
}

module.exports = {
  listAll,
  get,
  create,
  update,
  remove,
  listTagsFor,
  addTag,
  removeTag,
  listForOrder,
  addToOrder,
  removeFromOrder,
  setPricePaid,
  findByTitle,
  getByExternalId,
  ensureExternalId,
  setExternalId,
  getSalesDetail,
  listScanned,
  listWithLocation,
  createScanned,
  markScanPresent,
  markScanMissing,
};
