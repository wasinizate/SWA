'use strict';

// Repository layer for `tags`/`person_tags` (see 0009_person_tags.sql).
// The only place that writes raw SQL for either.

const { getDb } = require('../connection');

function listAll() {
  return getDb().prepare('SELECT * FROM tags ORDER BY label COLLATE NOCASE').all();
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

module.exports = { listAll, listForPerson, listGroupedByPerson, addToPerson, removeFromPerson };
