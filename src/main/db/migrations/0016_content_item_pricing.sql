-- Finer-grained pricing for the content library. Two additions:
--
-- 1. Per-file price on content_item_files (0015_content_scanning.sql) --
--    lets one video inside a multi-file "set" folder have its own
--    suggested price, distinct from the set's own content_items.price_cents
--    (the bundle price for the whole folder). 0 means "no individual
--    price set" -- the set price is still what's suggested as a whole.
ALTER TABLE content_item_files ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;

-- 2. Per-sale override on order_content_items (0014_content_library.sql) --
--    what was actually charged for this specific content item on this
--    specific order, distinct from both the item's own suggested
--    price_cents and the order's total amount_cents. Lets a bundled or
--    discounted sale record each item's real contribution instead of
--    every attached item implicitly claiming the whole order's amount
--    (see contentItem.js's getSalesDetail()/listAll() and
--    contentLibrary.js's "bundled orders" hint text -- this is what
--    that hint was flagging as a known approximation). NULL means "not
--    recorded", which falls back to the full order amount in the UI,
--    same behavior as before this column existed.
ALTER TABLE order_content_items ADD COLUMN price_paid_cents INTEGER;
