'use strict';

// Repository layer for `order_attachments`. The only place that writes
// raw SQL for it.

const { getDb } = require('../connection');

// Files (screenshots, examples) attached to an order. `data` (the actual
// file bytes) is deliberately left out of listByOrder()'s SELECT -- it's
// only fetched via get() when something specific needs the bytes (preview,
// save-to-disk), so rendering the attachment grid stays cheap even with
// several images attached.
function listByOrder(orderId) {
  return getDb()
    .prepare(
      `SELECT id, order_id, file_name, mime_type, byte_size, created_at
       FROM order_attachments WHERE order_id = ? ORDER BY created_at ASC`
    )
    .all(orderId);
}

function get(id) {
  return getDb().prepare('SELECT * FROM order_attachments WHERE id = ?').get(id);
}

function create({ orderId, fileName, mimeType, data }) {
  if (!orderId) throw new Error('orderId is required.');
  if (!fileName) throw new Error('fileName is required.');
  if (!data || data.length === 0) throw new Error('Attachment has no data.');

  // byte_size is computed from the actual bytes here, not trusted from
  // whatever the renderer reports, so it's always accurate.
  const result = getDb()
    .prepare(
      `INSERT INTO order_attachments (order_id, file_name, mime_type, byte_size, data)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(orderId, fileName, mimeType || 'application/octet-stream', data.length, data);

  // Return metadata only (not the data back) -- the renderer already has
  // the bytes it just sent.
  return listByOrder(orderId).find((row) => row.id === result.lastInsertRowid);
}

function remove(id) {
  getDb().prepare('DELETE FROM order_attachments WHERE id = ?').run(id);
}

module.exports = { listByOrder, get, create, remove };
