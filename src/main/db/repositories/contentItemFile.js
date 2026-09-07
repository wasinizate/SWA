'use strict';

// Repository layer for `content_item_files` (see
// 0015_content_scanning.sql, price_cents added in
// 0016_content_item_pricing.sql) -- the media file listing the scanner
// builds for each scanned content item. The only place that writes raw
// SQL for it.

const { getDb } = require('../connection');

function listFor(contentItemId) {
  return getDb()
    .prepare('SELECT * FROM content_item_files WHERE content_item_id = ? ORDER BY relative_path COLLATE NOCASE')
    .all(contentItemId);
}

// A set's whole file listing is always replaced together on each scan
// -- no row-by-row diffing needed for the filesystem facts themselves
// (name/extension/size/modified). price_cents is the one field a user
// sets by hand though, not something the scanner discovers, so it has
// to survive a delete-then-reinsert: existing prices are read first and
// carried forward onto any reinserted row with the same relative_path,
// same "don't let a rescan clobber user-entered data" reasoning as
// contentItem.js's markScanPresent() never touching title/price. A file
// that's gone (renamed/deleted) simply loses its row and price with it
// -- there's nothing to carry forward for a path that no longer exists.
// `files` is an array of { relativePath, extension, sizeBytes, modifiedAt }.
function replaceAll(contentItemId, files) {
  const db = getDb();
  const run = db.transaction((files) => {
    const existingPrices = new Map(
      db
        .prepare('SELECT relative_path, price_cents FROM content_item_files WHERE content_item_id = ?')
        .all(contentItemId)
        .map((row) => [row.relative_path, row.price_cents])
    );

    db.prepare('DELETE FROM content_item_files WHERE content_item_id = ?').run(contentItemId);
    const insert = db.prepare(
      `INSERT INTO content_item_files (content_item_id, relative_path, extension, size_bytes, modified_at, price_cents)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const file of files) {
      const carriedPrice = existingPrices.get(file.relativePath) || 0;
      insert.run(contentItemId, file.relativePath, file.extension, file.sizeBytes, file.modifiedAt, carriedPrice);
    }
  });
  run(files);
  return listFor(contentItemId);
}

// Bulk-saves per-file prices from the Files card's "Save file prices"
// button -- one round trip for the whole table rather than one call per
// row. `updates` is an array of { id, priceCents }; unknown ids are
// silently no-ops (WHERE id = ? just matches nothing).
function setPrices(contentItemId, updates) {
  const db = getDb();
  const run = db.transaction((updates) => {
    const stmt = db.prepare('UPDATE content_item_files SET price_cents = ? WHERE id = ? AND content_item_id = ?');
    for (const { id, priceCents } of updates) {
      stmt.run(Math.round(priceCents) || 0, id, contentItemId);
    }
  });
  run(updates);
  return listFor(contentItemId);
}

module.exports = { listFor, replaceAll, setPrices };
