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
const personLinkRepo = require('./personLink');

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

function update(id, { privateLabel, generalNotes, screeningNotes, isShared, priority }) {
  const existing = get(id);
  if (!existing) throw new Error(`Person ${id} not found.`);

  getDb()
    .prepare('UPDATE persons SET private_label = ?, general_notes = ?, screening_notes = ?, is_shared = ?, priority = ? WHERE id = ?')
    .run(
      privateLabel !== undefined ? privateLabel.trim() : existing.private_label,
      generalNotes !== undefined ? generalNotes : existing.general_notes,
      screeningNotes !== undefined ? screeningNotes : existing.screening_notes,
      isShared !== undefined ? (isShared ? 1 : 0) : existing.is_shared,
      priority !== undefined ? priority : existing.priority,
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

// Merges `loserId` into `survivorId`: every order, platform account,
// tag, and Activity log entry loserId owns is repointed to survivorId,
// then loserId is deleted -- for fixing a genuine duplicate client found
// via personDuplicates.js's findDuplicateCandidates() (or noticed by
// hand). Never automatic -- always a human-confirmed action, since
// merging the wrong two people is a much worse outcome than leaving an
// actual duplicate alone.
//
// Wrapped in one transaction: either the whole merge happens or none of
// it does, so a mid-merge failure can't leave orders repointed to
// survivorId while loserId still exists as an orphaned near-duplicate.
function mergeInto(loserId, survivorId) {
  if (loserId === survivorId) throw new Error('Cannot merge a client into themself.');
  const loser = get(loserId);
  const survivor = get(survivorId);
  if (!loser) throw new Error(`Client ${loserId} not found.`);
  if (!survivor) throw new Error(`Client ${survivorId} not found.`);

  const db = getDb();
  const run = db.transaction(() => {
    // Orders move over by reassigning person_id -- their own id is
    // unchanged, so everything keyed off *order_id* (attachments,
    // linked content items, a calendar event's linked_order_id) still
    // points at the right row with no change needed there at all.
    db.prepare('UPDATE orders SET person_id = ? WHERE person_id = ?').run(survivorId, loserId);

    // Platform accounts: skip any that would exactly duplicate one the
    // survivor already has (case-insensitive platform+username) --
    // that's very likely *why* this merge is happening in the first
    // place (see personDuplicates.js's "exact_account" tier). Skipped
    // rows simply vanish with loserId's own row at the end (ON DELETE
    // CASCADE), nothing left to clean up separately.
    const survivorAccounts = db.prepare('SELECT platform_name, username FROM platform_accounts WHERE person_id = ?').all(survivorId);
    const isDuplicateAccount = (a) =>
      survivorAccounts.some(
        (s) => s.platform_name.toLowerCase() === a.platform_name.toLowerCase() && s.username.toLowerCase() === a.username.toLowerCase()
      );
    const loserAccounts = db.prepare('SELECT id, platform_name, username FROM platform_accounts WHERE person_id = ?').all(loserId);
    const moveAccount = db.prepare('UPDATE platform_accounts SET person_id = ? WHERE id = ?');
    for (const account of loserAccounts) {
      if (!isDuplicateAccount(account)) moveAccount.run(survivorId, account.id);
    }

    // Tags: INSERT OR IGNORE handles person_tags' (person_id, tag_id)
    // PRIMARY KEY -- a tag the survivor already has is silently skipped
    // rather than erroring, same "adopt without duplicating" reasoning
    // as the platform accounts above. Old rows still pointing at
    // loserId are cleaned up by ON DELETE CASCADE when loserId is
    // deleted below.
    db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag_id) SELECT ?, tag_id FROM person_tags WHERE person_id = ?').run(
      survivorId,
      loserId
    );

    // Activity log entries move over as-is -- an append-only timeline,
    // not a set, so there's no "duplicate" concept to dedupe here (see
    // 0018_person_interactions.sql).
    db.prepare('UPDATE person_interactions SET person_id = ? WHERE person_id = ?').run(survivorId, loserId);

    // Person links (see 0019_person_links.sql): a link naming loserId
    // moves to survivorId, so "this client is connected to a third
    // person" doesn't just vanish because loserId got merged away. A
    // link *between* loserId and survivorId themselves is meaningless
    // after the merge (they're the same record now) and is simply
    // dropped -- along with every other now-stale row naming loserId --
    // by ON DELETE CASCADE when loserId is deleted below. INSERT OR
    // IGNORE against the UNIQUE(person_a_id, person_b_id) constraint
    // handles the case where survivor was already independently linked
    // to that same third person.
    const loserLinks = db.prepare('SELECT * FROM person_links WHERE person_a_id = ? OR person_b_id = ?').all(loserId, loserId);
    const insertLink = db.prepare('INSERT OR IGNORE INTO person_links (person_a_id, person_b_id, note) VALUES (?, ?, ?)');
    for (const link of loserLinks) {
      const otherPersonId = link.person_a_id === loserId ? link.person_b_id : link.person_a_id;
      if (otherPersonId === survivorId) continue;
      const [a, b] = personLinkRepo.orderPair(otherPersonId, survivorId);
      insertLink.run(a, b, link.note);
    }

    // Cross-instance identity (see 0008_data_export.sql/applyImport.js):
    // if loserId was ever itself synced/exported, its external_id needs
    // to keep resolving to *something* afterward, or a future sync from
    // that same remote source would recreate the very duplicate this
    // merge just fixed. Any existing aliases already pointing at
    // loserId move to survivorId directly -- no collision risk,
    // person_external_links.person_id isn't unique, only its
    // external_id column is.
    db.prepare('UPDATE person_external_links SET person_id = ? WHERE person_id = ?').run(survivorId, loserId);

    if (loser.external_id) {
      if (!survivor.external_id) {
        // Survivor never had its own identity -- simplest case, it just
        // adopts loser's. Cleared off loserId first since external_id
        // is UNIQUE and loserId's row (still holding it) hasn't been
        // deleted yet at this point in the transaction.
        db.prepare('UPDATE persons SET external_id = NULL WHERE id = ?').run(loserId);
        db.prepare('UPDATE persons SET external_id = ? WHERE id = ?').run(loser.external_id, survivorId);
      } else {
        // Both sides already had their own independent identity (each
        // was synced/exported separately before ever being recognized
        // as the same person). Survivor's own external_id stays
        // canonical; loser's becomes a remembered alias so a future
        // sync naming loser's external_id resolves straight to
        // survivor -- same alias mechanism contentItem.js's
        // cross-instance identity work added for content items (see
        // contentItemExternalLink.js).
        db.prepare('INSERT OR IGNORE INTO person_external_links (external_id, person_id) VALUES (?, ?)').run(loser.external_id, survivorId);
      }
    }

    db.prepare('DELETE FROM persons WHERE id = ?').run(loserId);
  });
  run();

  return get(survivorId);
}

module.exports = {
  listAll,
  get,
  create,
  update,
  remove,
  listShared,
  getByExternalId,
  ensureExternalId,
  setExternalId,
  mergeInto,
};
