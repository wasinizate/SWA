'use strict';

const { getDb } = require('../connection');

const DEFAULT_IDLE_TIMEOUT_SECONDS = 600; // 10 minutes
const DEFAULT_ORDER_DUE_REMINDER_ENABLED = true;
const DEFAULT_ORDER_DUE_REMINDER_DAYS_BEFORE = 1;
const DEFAULT_SHOW_DUE_SUMMARY_ON_OPEN = true;

// Small internal helpers shared by every setting below -- app_settings is
// a plain key/value table (see 0001_init.sql), so every getter/setter
// pair is the same two queries with a different key and default.
function getSetting(key, defaultValue) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function getIdleTimeoutSeconds() {
  return Number(getSetting('idle_timeout_seconds', DEFAULT_IDLE_TIMEOUT_SECONDS));
}

function setIdleTimeoutSeconds(seconds) {
  setSetting('idle_timeout_seconds', seconds);
}

function getOrderDueReminderEnabled() {
  return getSetting('order_due_reminder_enabled', DEFAULT_ORDER_DUE_REMINDER_ENABLED ? '1' : '0') === '1';
}

function setOrderDueReminderEnabled(enabled) {
  setSetting('order_due_reminder_enabled', enabled ? '1' : '0');
}

function getOrderDueReminderDaysBefore() {
  return Number(getSetting('order_due_reminder_days_before', DEFAULT_ORDER_DUE_REMINDER_DAYS_BEFORE));
}

function setOrderDueReminderDaysBefore(days) {
  setSetting('order_due_reminder_days_before', days);
}

function getShowDueSummaryOnOpen() {
  return getSetting('show_due_summary_on_open', DEFAULT_SHOW_DUE_SUMMARY_ON_OPEN ? '1' : '0') === '1';
}

function setShowDueSummaryOnOpen(enabled) {
  setSetting('show_due_summary_on_open', enabled ? '1' : '0');
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  getIdleTimeoutSeconds,
  setIdleTimeoutSeconds,
  getOrderDueReminderEnabled,
  setOrderDueReminderEnabled,
  getOrderDueReminderDaysBefore,
  setOrderDueReminderDaysBefore,
  getShowDueSummaryOnOpen,
  setShowDueSummaryOnOpen,
};
