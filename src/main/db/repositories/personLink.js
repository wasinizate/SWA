'use strict';

// Repository layer for `person_links` (see 0019_person_links.sql). The
// only place that writes raw SQL for it.

const { getDb } = require('../connection');

// Canonical (a, b) ordering -- smaller id first -- so the same pair is
// never stored as both (X, Y) and (Y, X). Every write goes through this.
function orderPair(personAId, personBId) {
  return personAId < personBId ? [personAId, personBId] : [personBId, personAId];
}

// Every link involving this person, with `other_person_id`/
// `other_person_label` already resolved to "whichever side isn't this
// person" -- the renderer never needs to know which column it landed in.
function listForPerson(personId) {
  return getDb()
    .prepare(
      `SELECT person_links.*,
              CASE WHEN person_links.person_a_id = ? THEN person_links.person_b_id ELSE person_links.person_a_id END AS other_person_id,
              persons.private_label AS other_person_label
       FROM person_links
       JOIN persons ON persons.id = CASE WHEN person_links.person_a_id = ? THEN person_links.person_b_id ELSE person_links.person_a_id END
       WHERE person_links.person_a_id = ? OR person_links.person_b_id = ?
       ORDER BY person_links.created_at DESC`
    )
    .all(personId, personId, personId, personId);
}

// INSERT OR IGNORE against the UNIQUE(person_a_id, person_b_id)
// constraint -- linking an already-linked pair again (e.g. from both
// sides' own pages) is a harmless no-op, not an error.
function create(personAId, personBId, note = '') {
  if (personAId === personBId) throw new Error('Cannot link a client to themself.');
  const [a, b] = orderPair(personAId, personBId);
  getDb().prepare('INSERT OR IGNORE INTO person_links (person_a_id, person_b_id, note) VALUES (?, ?, ?)').run(a, b, note);
}

function remove(id) {
  getDb().prepare('DELETE FROM person_links WHERE id = ?').run(id);
}

module.exports = { listForPerson, create, remove, orderPair };
