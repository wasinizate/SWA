-- Optional time-of-day to go with delivery_due_date. NULL means "just a
-- date, no specific time" (the original, still fully supported
-- behavior) -- this is additive, not a replacement.
ALTER TABLE orders ADD COLUMN delivery_due_time TEXT; -- 'HH:MM', 24-hour
