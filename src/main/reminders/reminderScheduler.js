'use strict';

// Desktop popup reminders for calendar events and order due dates. Same
// polling shape as ../security/idleLock.js (guards on the vault being
// unlocked, since the database is closed while locked), but a longer
// interval -- reminders don't need idleLock's tighter granularity.

const { Notification } = require('electron');
const passphrase = require('../security/passphrase');
const calendarEventRepo = require('../db/repositories/calendarEvent');
const orderRepo = require('../db/repositories/order');
const settingsRepo = require('../db/repositories/settings');

const POLL_INTERVAL_MS = 60_000;

let pollHandle = null;

// Local YYYY-MM-DD for "today" -- matches the plain <input type="date">
// values delivery_due_date is stored as (no time/timezone component).
function todayDateString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function showNotification(title, body, getMainWindow) {
  // TEMPORARY diagnostics while tracking down a report of no popup
  // appearing -- these print straight to this process's own terminal
  // (unlike renderer console.log, main-process console.log needs no
  // special forwarding). Safe to remove once confirmed working.
  console.log(`[reminder] Notification.isSupported() = ${Notification.isSupported()}`);
  console.log(`[reminder] attempting to show: "${title}" -- "${body}"`);

  if (!Notification.isSupported()) {
    console.log('[reminder] Skipped: Electron/the OS reports notifications are not supported here.');
    return;
  }

  const notification = new Notification({ title, body });
  notification.on('show', () => console.log('[reminder] "show" event fired -- OS accepted the notification.'));
  notification.on('failed', (_event, error) => console.log(`[reminder] "failed" event fired: ${error}`));
  notification.on('click', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  notification.show();
}

function checkCalendarEventReminders(getMainWindow) {
  const pending = calendarEventRepo.listPendingReminders();
  console.log(`[reminder] poll: ${pending.length} calendar event(s) with a reminder still pending`);
  const now = Date.now();

  for (const event of pending) {
    const dueAt = new Date(event.start_datetime).getTime() - event.reminder_minutes_before * 60_000;
    if (now >= dueAt) {
      showNotification(event.title, event.notes || 'Upcoming calendar event', getMainWindow);
      calendarEventRepo.markReminderFired(event.id);
    }
  }
}

function checkOrderDueReminders(getMainWindow) {
  if (!settingsRepo.getOrderDueReminderEnabled()) return;

  const daysBefore = settingsRepo.getOrderDueReminderDaysBefore();
  const today = todayDateString();
  const orders = orderRepo.listWithDeliveryDueDates();

  for (const order of orders) {
    if (order.due_reminder_notified_on === today) continue; // already notified today

    const dueDate = new Date(`${order.delivery_due_date}T00:00:00`);
    const reminderDate = new Date(dueDate.getTime() - daysBefore * 24 * 60 * 60 * 1000);
    const todayDate = new Date(`${today}T00:00:00`);

    if (todayDate.getTime() >= reminderDate.getTime()) {
      showNotification(
        `Order #${order.id} due ${order.delivery_due_date}`,
        `${order.person_label} -- click to open SWA`,
        getMainWindow
      );
      orderRepo.markDueReminderNotified(order.id, today);
    }
  }
}

// getMainWindow: a function returning the current BrowserWindow (not the
// window itself, since it can be recreated -- see main/index.js), used
// only to focus the app when a notification is clicked.
function start(getMainWindow) {
  stop();
  pollHandle = setInterval(() => {
    if (!passphrase.isUnlocked()) return;
    checkCalendarEventReminders(getMainWindow);
    checkOrderDueReminders(getMainWindow);
  }, POLL_INTERVAL_MS);
}

function stop() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

module.exports = { start, stop };
