'use strict';

// Repository layer: the only place that writes raw SQL for `persons`.
// IPC handlers and other code should always go through these functions
// rather than querying the database directly -- that keeps the SQL in one
// place if the schema ever changes.
//
// Naming note: the UI shows this concept as "Client" (see the renderer's
// people.js/personDetail.js), but the table, this file, IPC channel
// names, and every "person"/"personId" identifier in the codebase stay
// as-is. Renaming those too would be a large, purely-cosmetic refactor
// with no functional benefit -- "Client" is a display-label choice, not
// a data-model change.

const { getDb } = require('../connection');

function list() {
  return getDb().prepare('SELECT * FROM persons ORDER BY private_label COLLATE NOCASE').all();
}

function get(id) {
  return getDb().prepare('SELECT * FROM persons WHERE id = ?').get(id);
}

function create({ privateLabel, generalNotes = '', screeningNotes = '' }) {
  if (!privateLabel || !privateLabel.trim()) {
    throw new Error('privateLabel is required.');
  }
  const result = getDb()
    .prepare('INSERT INTO persons (private_label, general_notes, screening_notes) VALUES (?, ?, ?)')
    .run(privateLabel.trim(), generalNotes, screeningNotes);
  return get(result.lastInsertRowid);
}

function update(id, { privateLabel, generalNotes, screeningNotes }) {
  const existing = get(id);
  if (!existing) throw new Error(`Person ${id} not found.`);

  getDb()
    .prepare('UPDATE persons SET private_label = ?, general_notes = ?, screening_notes = ? WHERE id = ?')
    .run(
      privateLabel !== undefined ? privateLabel.trim() : existing.private_label,
      generalNotes !== undefined ? generalNotes : existing.general_notes,
      screeningNotes !== undefined ? screeningNotes : existing.screening_notes,
      id
    );
  return get(id);
}

function remove(id) {
  // ON DELETE CASCADE (declared in the schema) takes care of that person's
  // platform_accounts and orders automatically.
  getDb().prepare('DELETE FROM persons WHERE id = ?').run(id);
}

module.exports = { list, get, create, update, remove };
