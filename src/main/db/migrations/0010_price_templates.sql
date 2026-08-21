-- Named, per-platform price templates for the order calculator (see
-- orderDetail.js's "Price calculator") -- a reusable set of line items
-- (e.g. "Custom video: $5/min" + "Toy add-on: $10" + "Anal add-on: $10")
-- that can be loaded into any order instead of retyping it every time,
-- plus a suggested default discount %. Two tables, same normalized
-- "dedicated table per relationship" shape as platform_accounts/
-- person_tags -- price_template_items is never queried on its own
-- outside "all items for this template", but a child table still keeps
-- this schema's style consistent rather than introducing a first JSON
-- blob column.

CREATE TABLE IF NOT EXISTS price_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Free text, same as platform_accounts.platform_name -- deliberately
    -- not FK'd to it, so a template can be set up before any client on
    -- that platform exists yet.
    platform_name TEXT NOT NULL,
    label TEXT NOT NULL,
    default_discount_percent REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_price_templates_platform_name ON price_templates(platform_name);

CREATE TABLE IF NOT EXISTS price_template_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price_template_id INTEGER NOT NULL REFERENCES price_templates(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    -- Integer cents, same "money is never a float" rule as orders.amount_cents.
    rate_cents INTEGER NOT NULL DEFAULT 0,
    default_qty REAL NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_price_template_items_template_id ON price_template_items(price_template_id);
