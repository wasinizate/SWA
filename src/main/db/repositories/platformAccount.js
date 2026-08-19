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

module.exports = { listByPerson, get, create, update, remove };
