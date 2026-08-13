-- Calendar events, optionally linked to an order (e.g. a delivery due
-- date reminder). start_datetime/end_datetime are ISO-8601 UTC TEXT,
-- same convention as every other timestamp in this app -- the renderer
-- converts to/from the browser's local time at the form boundary (see
-- toDatetimeLocalValue/fromDatetimeLocalValue in src/renderer/helpers.js).
--
-- reminder_minutes_before / reminder_fired_at are unused until the next
-- round (desktop popup reminders) -- added now so that work doesn't need
-- a second migration touching this same table right after this one.

CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linked_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    start_datetime TEXT NOT NULL,
    end_datetime TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    reminder_minutes_before INTEGER,
    reminder_fired_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_datetime);
CREATE INDEX IF NOT EXISTS idx_calendar_events_linked_order ON calendar_events(linked_order_id);
