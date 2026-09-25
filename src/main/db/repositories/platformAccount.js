'use strict';

// Repository layer for `platform_accounts`. The only place that writes
// raw SQL for it.

const { getDb } = require('../connection');

function listByPerson(personId) {
  return getDb()
    .prepare('SELECT * FROM platform_accounts WHERE person_id = ? ORDER BY platform_name COLLATE NOCASE')
    .all(personId);
}

function get(id) {
  return getDb().prepare('SELECT * FROM platform_accounts WHERE id = ?').get(id);
}

// Catch-at-entry duplicate check: is this exact (platform, username)
// already linked to a client? There's no UNIQUE constraint enforcing
// this in the schema -- a platform handle genuinely could belong to
// more than one client in some edge case -- but in practice the same
// handle showing up twice is almost always either a real duplicate
// client or a copy/paste mistake, so the Add account form checks this
// before inserting and asks first rather than silently allowing it (see
// personDuplicates.js's "exact_account" tier for the same signal, used
// there to catch cases that slipped through anyway). excludePersonId
// lets an existing account's own edit form check without flagging
// itself.
function findByPlatformAndUsername(platformName, username, { excludePersonId } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT platform_accounts.*, persons.private_label AS person_label
       FROM platform_accounts
       JOIN persons ON persons.id = platform_accounts.person_id
       WHERE platform_accounts.platform_name = ? COLLATE NOCASE
         AND platform_accounts.username = ? COLLATE NOCASE`
    )
    .all(platformName, username);
  return excludePersonId ? rows.filter((r) => r.person_id !== excludePersonId) : rows;
}

function create({ personId, platformName, username, verified = false }) {
  if (!platformName || !platformName.trim()) throw new Error('platformName is required.');
  if (!username || !username.trim()) throw new Error('username is required.');

  const result = getDb()
    .prepare('INSERT INTO platform_accounts (person_id, platform_name, username, verified) VALUES (?, ?, ?, ?)')
    .run(personId, platformName.trim(), username.trim(), verified ? 1 : 0);
  return get(result.lastInsertRowid);
}

function update(id, { platformName, username, verified }) {
  const existing = get(id);
  if (!existing) throw new Error(`Platform account ${id} not found.`);

  getDb()
    .prepare('UPDATE platform_accounts SET platform_name = ?, username = ?, verified = ? WHERE id = ?')
    .run(
      platformName !== undefined ? platformName.trim() : existing.platform_name,
      username !== undefined ? username.trim() : existing.username,
      verified !== undefined ? (verified ? 1 : 0) : existing.verified,
      id
    );
  return get(id);
}

function remove(id) {
  // ON DELETE SET NULL (declared in the schema) un-links any orders that
  // pointed at this account instead of deleting their history.
  getDb().prepare('DELETE FROM platform_accounts WHERE id = ?').run(id);
}

module.exports = { listByPerson, get, create, update, remove, findByPlatformAndUsername };
