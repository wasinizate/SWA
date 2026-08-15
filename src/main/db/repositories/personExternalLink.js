'use strict';

// Repository layer for `person_external_links` (see
// 0008_data_export.sql's comment for what this table is for). The only
// place that writes raw SQL for it.

const { getDb } = require('../connection');

function getPersonIdForExternalId(externalId) {
  const row = getDb().prepare('SELECT person_id FROM person_external_links WHERE external_id = ?').get(externalId);
  return row ? row.person_id : null;
}

function create(externalId, personId) {
  getDb()
    .prepare('INSERT INTO person_external_links (external_id, person_id) VALUES (?, ?)')
    .run(externalId, personId);
}

module.exports = { getPersonIdForExternalId, create };
