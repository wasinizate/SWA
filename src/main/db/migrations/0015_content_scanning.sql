-- Media folder scanner support for the content library (see
-- src/main/scanner/contentScanner.js). Lets a content_items row be
-- either typed by hand (Phase 2) or discovered from a real folder on
-- disk -- both paths write the same columns, so nothing downstream
-- (tags, order_content_items, analytics) needs to know which one made
-- a given row.

ALTER TABLE content_items ADD COLUMN is_scanned INTEGER NOT NULL DEFAULT 0;
-- Set when a previously-scanned item's folder wasn't found on the most
-- recent scan (moved, renamed, drive unplugged/removed). Never cleared
-- by deleting the item or its tags/price/sales links -- only by the
-- folder reappearing on a later scan. See contentScanner.js's matching
-- comments for why this is path-based, not content-based.
ALTER TABLE content_items ADD COLUMN folder_missing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_items ADD COLUMN last_scanned_at TEXT;

-- One row per media file found inside a scanned content item's folder
-- (recursively, within the caps contentScanner.js applies). Entirely
-- replaced on every scan of that item -- see contentItemFile.js's
-- replaceAll(). Same "dedicated table per relationship" shape as
-- content_item_tags/order_content_items.
CREATE TABLE IF NOT EXISTS content_item_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    extension TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT,
    UNIQUE(content_item_id, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_content_item_files_content_item_id ON content_item_files(content_item_id);
