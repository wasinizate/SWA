-- Portable identity for content items, so an order's "this content item
-- was part of the sale" fact survives being exported/synced to another
-- install -- exact same shape as persons/orders' own external_id +
-- *_external_links pair (see 0008_data_export.sql's comment for the
-- full reasoning; contentItem.js/contentItemExternalLink.js mirror
-- person.js/personExternalLink.js here on purpose). Without this, the
-- content_items.id an order_content_items row points at is only ever
-- meaningful inside the database that created it -- exporting the order
-- to another install had nothing portable to carry that link with, so
-- the attachment was silently dropped. This is what fixes that.
ALTER TABLE content_items ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_external_id ON content_items(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS content_item_external_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
