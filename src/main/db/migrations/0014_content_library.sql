-- Content library: a catalog of what's been made (video/picture set/
-- etc.), with sales stats derived from which orders it was attached to.
-- Three tables, same "dedicated table per relationship" shape already
-- used throughout this schema (platform_accounts, person_tags,
-- price_template_items).

CREATE TABLE IF NOT EXISTS content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    -- Free text, e.g. "Video"/"Picture set" -- same convention as
    -- platform_accounts.platform_name, not a fixed list.
    content_type TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    -- Where the actual file lives (a path, drive label, folder link) --
    -- NOT stored as a BLOB here, unlike order_attachments. This app
    -- doesn't want multi-GB video files inside the encrypted DB.
    location TEXT NOT NULL DEFAULT '',
    -- Suggested/default price, informational only -- an order's own
    -- amount_cents is still the source of truth for what was actually
    -- charged (see contentItem.js's revenue-stat comments).
    price_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Reuses the existing global `tags` table (0009_person_tags.sql) rather
-- than a separate content-tag vocabulary -- one tag like "anal" can
-- mark both a client's preference and the content that matches it, so
-- search can eventually connect the two.
CREATE TABLE IF NOT EXISTS content_item_tags (
    content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (content_item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_content_item_tags_tag_id ON content_item_tags(tag_id);

-- Which content item(s) were part of an order. No qty/price-split
-- columns on purpose -- this stays a simple "was this item part of this
-- sale" fact, not a full line-item ledger.
CREATE TABLE IF NOT EXISTS order_content_items (
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    content_item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    PRIMARY KEY (order_id, content_item_id)
);
CREATE INDEX IF NOT EXISTS idx_order_content_items_content_item_id ON order_content_items(content_item_id);
