'use strict';

// Repository layer for `calendar_events`. The only place that writes raw
// SQL for it.

const { getDb } = require('../connection');

// listAll() fetches every event, no date-range windowing -- reasonable
// for a personal calendar's scale, and FullCalendar handles the actual
// view windowing (month/week/list) client-side.
function listAll() {
  return getDb().prepare('SELECT * FROM calendar_events ORDER BY start_datetime ASC').all();
}

function get(id) {
  return getDb().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
}

function create({
  linkedOrderId = null,
  title,
  startDatetime,
  endDatetime = null,
  allDay = false,
  type = '',
  notes = '',
  reminderMinutesBefore = null,
}) {
  if (!title || !title.trim()) throw new Error('title is required.');
  if (!startDatetime) throw new Error('startDatetime is required.');

  const result = getDb()
    .prepare(
      `INSERT INTO calendar_events (linked_order_id, title, start_datetime, end_datetime, all_day, type, notes, reminder_minutes_before)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(linkedOrderId, title.trim(), startDatetime, endDatetime, allDay ? 1 : 0, type, notes, reminderMinutesBefore);
  return get(result.lastInsertRowid);
}

function update(id, fields) {
  const existing = get(id);
  if (!existing) throw new Error(`Calendar event ${id} not found.`);

  const merged = { ...toCamel(existing), ...fields };

  // If the reminder setting actually changed, let it fire again --
  // otherwise a reminder that already fired once could never fire again
  // even after being retargeted to a new time/offset.
  const reminderChanged = merged.reminderMinutesBefore !== existing.reminder_minutes_before;
  const reminderFiredAt = reminderChanged ? null : existing.reminder_fired_at;

  getDb()
    .prepare(
      `UPDATE calendar_events SET
         linked_order_id = ?, title = ?, start_datetime = ?, end_datetime = ?,
         all_day = ?, type = ?, notes = ?, reminder_minutes_before = ?, reminder_fired_at = ?
       WHERE id = ?`
    )
    .run(
      merged.linkedOrderId,
      merged.title,
      merged.startDatetime,
      merged.endDatetime,
      merged.allDay ? 1 : 0,
      merged.type,
      merged.notes,
      merged.reminderMinutesBefore,
      reminderFiredAt,
      id
    );
  return get(id);
}

function remove(id) {
  getDb().prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
}

// Events with a reminder configured that hasn't fired yet -- polled by
// src/main/reminders/reminderScheduler.js.
function listPendingReminders() {
  return getDb()
    .prepare('SELECT * FROM calendar_events WHERE reminder_minutes_before IS NOT NULL AND reminder_fired_at IS NULL')
    .all();
}

function markReminderFired(id) {
  getDb()
    .prepare(`UPDATE calendar_events SET reminder_fired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(id);
}

// Converts a raw (snake_case) DB row into the camelCase shape used by
// create()/update() inputs, so update() can merge a partial patch onto
// the existing row without repeating every field name twice.
function toCamel(row) {
  return {
    linkedOrderId: row.linked_order_id,
    title: row.title,
    startDatetime: row.start_datetime,
    endDatetime: row.end_datetime,
    allDay: !!row.all_day,
    type: row.type,
    notes: row.notes,
    reminderMinutesBefore: row.reminder_minutes_before,
  };
}

module.exports = { listAll, get, create, update, remove, listPendingReminders, markReminderFired };
