-- Priority for persons (see 0009_person_tags.sql for the related but
-- separate "content preference" tags) -- same "free text with a small
-- fixed set" convention already used for calendar_events.priority
-- (0011_calendar_event_priority.sql): not a CHECK-constrained enum,
-- just a TEXT column with a UI that only offers a few values
-- (low/normal/vip). Drives a badge in the Clients list and on the
-- client's own page.

ALTER TABLE persons ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
