'use strict';

// Repository layer for `content_item_external_links` (see
// 0017_content_item_external_id.sql's comment for what this table is
// for). The only place that writes raw SQL for it. Exact mirror of
// personExternalLink.js -- same "remembered manual link" role, just for
// content items instead of clients.

const { getDb } = require('../connection');

function getContentItemIdForExternalId(externalId) {
  const row = getDb().prepare('SELECT content_item_id FROM content_item_external_links WHERE external_id = ?').get(externalId);
  return row ? row.content_item_id : null;
}

function create(externalId, contentItemId) {
  getDb()
    .prepare('INSERT INTO content_item_external_links (external_id, content_item_id) VALUES (?, ?)')
    .run(externalId, contentItemId);
}

module.exports = { getContentItemIdForExternalId, create };
