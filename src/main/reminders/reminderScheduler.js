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
const STALE_REMINDER_MS = 60 * 60 * 1000;

let pollHandle = null;

// Local YYYY-MM-DD for "today" -- matches the plain <input type="date">
// values delivery_due_date is stored as (no time/timezone component).
function todayDateString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function showNotification(title, body, getMainWindow) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title, body });
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
  const now = Date.now();

  for (const event of pending) {
    const startsAt = new Date(event.start_datetime).getTime();
    // Long past (an imported .ics full of old events, or one backdated by
    // hand): retire the reminder quietly instead of a burst of popups
    // about things that already happened. Within the first hour it still
    // fires, in case the app just wasn't open at reminder time.
    if (now > startsAt + STALE_REMINDER_MS) {
      calendarEventRepo.markReminderFired(event.id);
      continue;
    }
    const dueAt = startsAt - event.reminder_minutes_before * 60_000;
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
    // A finished order isn't due anymore. (listWithDeliveryDueDates() keeps
    // completed orders for the Calendar, so without this every completed
    // order with a past due date got a fresh notification every day.)
    if (order.status === 'completed') continue;

    // Calendar-day arithmetic (setDate), not N x 24h, so a daylight-saving
    // change in between can't push the reminder back a day.
    const reminderDate = new Date(`${order.delivery_due_date}T00:00:00`);
    reminderDate.setDate(reminderDate.getDate() - daysBefore);
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
