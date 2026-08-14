'use strict';

// Files (the source pay-statement PDF) attached to an income statement.
// Same shape as orderAttachment.js -- see that file and
// 0007_expenses_and_income.sql's comment for why this stays BLOB-in-the-
// encrypted-DB rather than a file path.

const { getDb } = require('../connection');

// `data` is deliberately left out of listByStatement()'s SELECT -- it's
// only fetched via get() when something specific needs the bytes
// (preview, save-to-disk), so rendering the attachment list stays cheap.
function listByStatement(incomeStatementId) {
  return getDb()
    .prepare(
      `SELECT id, income_statement_id, file_name, mime_type, byte_size, created_at
       FROM income_statement_attachments WHERE income_statement_id = ? ORDER BY created_at ASC`
    )
    .all(incomeStatementId);
}

function get(id) {
  return getDb().prepare('SELECT * FROM income_statement_attachments WHERE id = ?').get(id);
}

function create({ incomeStatementId, fileName, mimeType, data }) {
  if (!incomeStatementId) throw new Error('incomeStatementId is required.');
  if (!fileName) throw new Error('fileName is required.');
  if (!data || data.length === 0) throw new Error('Attachment has no data.');

  // byte_size is computed from the actual bytes here, not trusted from
  // whatever the renderer reports, so it's always accurate.
  const result = getDb()
    .prepare(
      `INSERT INTO income_statement_attachments (income_statement_id, file_name, mime_type, byte_size, data)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(incomeStatementId, fileName, mimeType || 'application/octet-stream', data.length, data);

  return listByStatement(incomeStatementId).find((row) => row.id === result.lastInsertRowid);
}

function remove(id) {
  getDb().prepare('DELETE FROM income_statement_attachments WHERE id = ?').run(id);
}

module.exports = { listByStatement, get, create, remove };
