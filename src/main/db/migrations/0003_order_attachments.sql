-- Files (screenshots, examples) attached to an order. Kept in its own
-- table -- rather than a column on `orders` -- so ordinary order reads,
-- lists, and the totals aggregation queries never touch attachment bytes.
--
-- `data` is stored as a BLOB inside this same encrypted database file, on
-- purpose: attachments (screenshots of chats, IDs, payment confirmations)
-- are often the most sensitive content in this app, so they need the same
-- encryption-at-rest guarantee as everything else, not a plaintext file
-- sitting next to the database.

CREATE TABLE IF NOT EXISTS order_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    byte_size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_order_attachments_order_id ON order_attachments(order_id);
