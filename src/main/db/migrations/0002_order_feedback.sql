-- Adds post-order reflection fields, used to help spot trends with a
-- client over time (see the "Feedback & reflection" section on the order
-- form). Order status itself stays a free TEXT column -- the fixed
-- 5-option dropdown is enforced in the renderer (see ORDER_STATUSES in
-- src/renderer/helpers.js), not the schema, so any pre-existing free-text
-- status value from before this migration keeps working.

ALTER TABLE orders ADD COLUMN feedback_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN would_repeat TEXT NOT NULL DEFAULT '';
