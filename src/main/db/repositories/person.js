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

const crypto = require('crypto');
const { getDb } = require('../connection');

function listAll() {
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

function update(id, { privateLabel, generalNotes, screeningNotes, isShared }) {
  const existing = get(id);
  if (!existing) throw new Error(`Person ${id} not found.`);

  getDb()
    .prepare('UPDATE persons SET private_label = ?, general_notes = ?, screening_notes = ?, is_shared = ? WHERE id = ?')
    .run(
      privateLabel !== undefined ? privateLabel.trim() : existing.private_label,
      generalNotes !== undefined ? generalNotes : existing.general_notes,
      screeningNotes !== undefined ? screeningNotes : existing.screening_notes,
      isShared !== undefined ? (isShared ? 1 : 0) : existing.is_shared,
      id
    );
  return get(id);
}

function remove(id) {
  // ON DELETE CASCADE (declared in the schema) takes care of that person's
  // platform_accounts and orders automatically.
  getDb().prepare('DELETE FROM persons WHERE id = ?').run(id);
}

// Shared-folder sync support (see src/main/sync/) -- every client
// currently marked shared, all of whose orders get included in that
// client's periodic export.
function listShared() {
  return getDb().prepare('SELECT * FROM persons WHERE is_shared = 1 ORDER BY private_label COLLATE NOCASE').all();
}

// Cross-instance export/import support (see src/main/dataExchange/) --
// external_id is a portable UUID, distinct from the local id above.
function getByExternalId(externalId) {
  return getDb().prepare('SELECT * FROM persons WHERE external_id = ?').get(externalId);
}

// Generates and persists a UUID for this person if they don't already
// have one, then returns it either way. Called right before a person is
// included in an export -- most persons never get one, since most are
// never exported.
function ensureExternalId(id) {
  const existing = get(id);
  if (!existing) throw new Error(`Person ${id} not found.`);
  if (existing.external_id) return existing.external_id;

  const externalId = crypto.randomUUID();
  getDb().prepare('UPDATE persons SET external_id = ? WHERE id = ?').run(externalId, id);
  return externalId;
}

// Unconditionally assigns an external_id -- used only when applyImport.js
// creates a brand-new local person to represent an imported one, so the
// new local row shares the *source's* external_id (making a repeat
// import of the same person recognize this row directly via
// getByExternalId(), no person_external_links entry even needed).
// ensureExternalId() above is for the opposite direction (mint a fresh
// id for a local person about to be exported) and never overwrites an
// existing one -- this always does, so it's kept separate.
function setExternalId(id, externalId) {
  getDb().prepare('UPDATE persons SET external_id = ? WHERE id = ?').run(externalId, id);
}

module.exports = { listAll, get, create, update, remove, listShared, getByExternalId, ensureExternalId, setExternalId };
