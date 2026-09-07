'use strict';

// Repository layer for `tags`/`person_tags` (see 0009_person_tags.sql).
// The only place that writes raw SQL for either -- content_item_tags
// (0014_content_library.sql) reuses this same `tags` table but is owned
// by contentItem.js, not here; this file only reads it for the usage
// count below.

const { getDb } = require('../connection');

// usage_count/content_usage_count ride along so the Settings "Tags"
// management card can show "used by N client(s), M content item(s)"
// without a separate query per row. Two correlated subqueries rather
// than two LEFT JOINs -- joining both person_tags and content_item_tags
// onto tags at once would fan out (a tag on 2 clients and 3 content
// items would produce 6 rows before any GROUP BY), so this avoids
// getting the count wrong by construction instead of trying to
// COUNT(DISTINCT ...) around it.
function listAll() {
  return getDb()
    .prepare(
      `SELECT tags.*,
              (SELECT COUNT(*) FROM person_tags WHERE person_tags.tag_id = tags.id) AS usage_count,
              (SELECT COUNT(*) FROM content_item_tags WHERE content_item_tags.tag_id = tags.id) AS content_usage_count
       FROM tags
       ORDER BY tags.label COLLATE NOCASE`
    )
    .all();
}

function listForPerson(personId) {
  return getDb()
    .prepare(
      `SELECT tags.id, tags.label
       FROM person_tags
       JOIN tags ON tags.id = person_tags.tag_id
       WHERE person_tags.person_id = ?
       ORDER BY tags.label COLLATE NOCASE`
    )
    .all(personId);
}

// One query for every person's tags at once (grouped here in JS --
// better-sqlite3 has no array-agg), used by the Clients list so
// rendering the whole table isn't N+1 queries.
function listGroupedByPerson() {
  const rows = getDb()
    .prepare(
      `SELECT person_tags.person_id AS personId, tags.id, tags.label
       FROM person_tags
       JOIN tags ON tags.id = person_tags.tag_id
       ORDER BY tags.label COLLATE NOCASE`
    )
    .all();

  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.personId]) grouped[row.personId] = [];
    grouped[row.personId].push({ id: row.id, label: row.label });
  }
  return grouped;
}

// Finds an existing tag by case-insensitive label (the UNIQUE COLLATE
// NOCASE constraint is what actually enforces this; this lookup is what
// lets a re-typed "Regular"/"regular"/"REGULAR" reuse the same row
// instead of erroring on the constraint) or creates one.
function findOrCreateByLabel(label) {
  const trimmed = (label || '').trim();
  if (!trimmed) throw new Error('Tag label is required.');

  const db = getDb();
  const existing = db.prepare('SELECT * FROM tags WHERE label = ? COLLATE NOCASE').get(trimmed);
  if (existing) return existing;

  const result = db.prepare('INSERT INTO tags (label) VALUES (?)').run(trimmed);
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
}

// Returns the person's updated tag list, same "return the fresh state"
// convention as e.g. order.js's update().
function addToPerson(personId, label) {
  const tag = findOrCreateByLabel(label);
  getDb().prepare('INSERT OR IGNORE INTO person_tags (person_id, tag_id) VALUES (?, ?)').run(personId, tag.id);
  return listForPerson(personId);
}

function removeFromPerson(personId, tagId) {
  getDb().prepare('DELETE FROM person_tags WHERE person_id = ? AND tag_id = ?').run(personId, tagId);
  return listForPerson(personId);
}

// Renames a tag everywhere it's used (it's a single shared row, not a
// per-client copy) -- fixes a typo without having to remove and re-add
// it on every client that already has it. Proactively checks the
// COLLATE NOCASE unique constraint against *other* tags first (same
// "check before you write" style as findOrCreateByLabel()'s lookup)
// rather than surfacing a raw SQLite constraint-violation message.
function rename(tagId, newLabel) {
  const trimmed = (newLabel || '').trim();
  if (!trimmed) throw new Error('Tag label is required.');

  const db = getDb();
  const collision = db.prepare('SELECT id FROM tags WHERE label = ? COLLATE NOCASE AND id != ?').get(trimmed, tagId);
  if (collision) throw new Error(`A tag named "${trimmed}" already exists.`);

  db.prepare('UPDATE tags SET label = ? WHERE id = ?').run(trimmed, tagId);
  return listAll();
}

// Both person_tags.tag_id (0009_person_tags.sql) and
// content_item_tags.tag_id (0014_content_library.sql) are ON DELETE
// CASCADE, so every client's and content item's association to this
// tag is dropped automatically -- nothing else to clean up here.
function remove(tagId) {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  return listAll();
}

module.exports = {
  listAll,
  listForPerson,
  listGroupedByPerson,
  addToPerson,
  removeFromPerson,
  rename,
  remove,
  // Exported so contentItem.js can reuse the same shared tag vocabulary
  // (find-or-create by case-insensitive label) instead of duplicating
  // this logic for a second kind of taggable thing.
  findOrCreateByLabel,
};
