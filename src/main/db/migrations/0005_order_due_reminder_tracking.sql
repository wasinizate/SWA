-- Tracks the last date a desktop reminder fired for an order's delivery
-- due date (see src/main/reminders/reminderScheduler.js), so it notifies
-- at most once per day rather than on every poll once a due date enters
-- the reminder window. Changing the due date to a new value naturally
-- "resets" this, since the comparison is against the current due date.

ALTER TABLE orders ADD COLUMN due_reminder_notified_on TEXT;
