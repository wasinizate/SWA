'use strict';

// Repository layer for `sync_seen` (see 0012_shared_sync.sql's
// comment). The only place that writes raw SQL for it.

const { getDb } = require('../connection');

function get(sourceInstanceId, personExternalId) {
  return getDb()
    .prepare('SELECT * FROM sync_seen WHERE source_instance_id = ? AND person_external_id = ?')
    .get(sourceInstanceId, personExternalId);
}

function markSeen(sourceInstanceId, personExternalId, exportedAt) {
  getDb()
    .prepare(
      `INSERT INTO sync_seen (source_instance_id, person_external_id, last_exported_at) VALUES (?, ?, ?)
       ON CONFLICT(source_instance_id, person_external_id) DO UPDATE SET last_exported_at = excluded.last_exported_at`
    )
    .run(sourceInstanceId, personExternalId, exportedAt);
}

module.exports = { get, markSeen };
