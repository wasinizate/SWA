'use strict';

// Repository layer for `person_interactions` (see
// 0018_person_interactions.sql). The only place that writes raw SQL for
// it. An append-only per-client timeline that can optionally carry a
// follow-up due date -- see the migration's own comment for why a
// follow-up isn't a separate concept from the note that prompted it.

const { getDb } = require('../connection');

function listForPerson(personId) {
  return getDb()
    .prepare('SELECT * FROM person_interactions WHERE person_id = ? ORDER BY created_at DESC')
    .all(personId);
}

function get(id) {
  return getDb().prepare('SELECT * FROM person_interactions WHERE id = ?').get(id);
}

function create(personId, { type = 'note', text, followUpDate = null }) {
  if (!text || !text.trim()) throw new Error('text is required.');

  getDb()
    .prepare('INSERT INTO person_interactions (person_id, type, text, follow_up_date) VALUES (?, ?, ?, ?)')
    .run(personId, type || 'note', text.trim(), followUpDate || null);
  return listForPerson(personId);
}

// Both remove() and resolveFollowUp() look the row up first purely to
// find its person_id -- so the caller gets back the same "fresh list for
// this person" shape every other mutator in this codebase returns,
// without having to also pass personId in for what's otherwise an
// id-only action. An id that's already gone (e.g. a double-click) is a
// harmless no-op, not an error.
function remove(id) {
  const existing = get(id);
  if (!existing) return [];
  getDb().prepare('DELETE FROM person_interactions WHERE id = ?').run(id);
  return listForPerson(existing.person_id);
}

function resolveFollowUp(id) {
  const existing = get(id);
  if (!existing) return [];
  getDb()
    .prepare(`UPDATE person_interactions SET follow_up_resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(id);
  return listForPerson(existing.person_id);
}

// ---- Follow-ups queue (cross-client -- see followUps.js) --------------

const OPEN_FOLLOW_UP_WHERE = 'follow_up_date IS NOT NULL AND follow_up_resolved_at IS NULL';

// Every open follow-up across every client, bucketed the same way
// order.js's getDueDateSummary() buckets delivery due dates (date('now',
// 'localtime') comparisons done in SQL, not re-derived from a UTC
// timestamp in the renderer -- see CLAUDE.md's note on date/timezone
// bugs in this codebase). Unlike getDueDateSummary(), `upcoming` has no
// days-ahead cutoff -- this feeds a dedicated queue page meant to be
// browsed, not a small home-screen popup.
function getFollowUpSummary() {
  const db = getDb();
  const base = `
    SELECT person_interactions.id, person_interactions.person_id, persons.private_label AS person_label,
           person_interactions.type, person_interactions.text, person_interactions.follow_up_date,
           person_interactions.created_at
    FROM person_interactions
    JOIN persons ON persons.id = person_interactions.person_id
    WHERE ${OPEN_FOLLOW_UP_WHERE}
  `;

  const overdue = db
    .prepare(`${base} AND person_interactions.follow_up_date < date('now', 'localtime') ORDER BY person_interactions.follow_up_date ASC`)
    .all();
  const dueToday = db
    .prepare(`${base} AND person_interactions.follow_up_date = date('now', 'localtime') ORDER BY person_interactions.created_at ASC`)
    .all();
  const upcoming = db
    .prepare(`${base} AND person_interactions.follow_up_date > date('now', 'localtime') ORDER BY person_interactions.follow_up_date ASC`)
    .all();

  return { overdue, dueToday, upcoming };
}

// Overdue + due today only -- the "needs action now" count for the
// Dashboard stat tile, same urgency framing as its "Quiet clients"/
// "Open orders" tiles. The full queue (getFollowUpSummary() above) also
// lists future-dated ones; this deliberately doesn't count those.
function getOpenFollowUpCount() {
  return getDb()
    .prepare(`SELECT COUNT(*) AS count FROM person_interactions WHERE ${OPEN_FOLLOW_UP_WHERE} AND follow_up_date <= date('now', 'localtime')`)
    .get().count;
}

module.exports = { listForPerson, create, remove, resolveFollowUp, getFollowUpSummary, getOpenFollowUpCount };
