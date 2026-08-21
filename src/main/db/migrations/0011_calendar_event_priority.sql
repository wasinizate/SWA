-- Priority for calendar_events (see 0004_calendar_events.sql) -- free
-- text with a small fixed set ('normal'/'high'/'urgent'), same
-- "free text over enum" convention as orders.status/platform_name.
-- Drives a color cue on the calendar grid and maps to RFC 5545's
-- PRIORITY property on .ics export (see src/main/calendar/icsExport.js).

ALTER TABLE calendar_events ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
