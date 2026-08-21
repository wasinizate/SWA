'use strict';

const fs = require('fs');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const calendarEventRepo = require('../db/repositories/calendarEvent');
const orderRepo = require('../db/repositories/order');
const personRepo = require('../db/repositories/person');
const { buildIcs } = require('../calendar/icsExport');
const { parseIcs } = require('../calendar/icsImport');

// RFC 5545: 1 = highest ... 9 = lowest, 0/absent = undefined. 'normal'
// deliberately omits the property rather than sending a mid-range
// number, matching the spec's own "undefined priority" convention.
const ICS_PRIORITY_BY_LEVEL = { urgent: 1, high: 5 };

// Converts one calendar_events row into buildIcs()'s item shape. An
// order-linked event's exported title is always recomputed fresh as
// "Order #<id> for <client>" from current order/person data -- not
// whatever's in the stored `title` column -- so it stays correct even
// if the client's label changes later, and always matches what the user
// asked for regardless of what they've typed in-app.
function eventToIcsItem(event) {
  let title = event.title;
  if (event.linked_order_id) {
    const order = orderRepo.get(event.linked_order_id);
    const person = order ? personRepo.get(order.person_id) : null;
    if (order && person) title = `Order #${order.id} for ${person.private_label}`;
  }

  return {
    uid: `event-${event.id}@swa.app`,
    title,
    notes: event.notes,
    start: event.start_datetime,
    end: event.end_datetime,
    allDay: !!event.all_day,
    priority: ICS_PRIORITY_BY_LEVEL[event.priority],
  };
}

// Converts one "order with a delivery due date" row (see
// order.listWithDeliveryDueDates()) into buildIcs()'s item shape -- a
// timed entry when the order has a specific due time set, otherwise an
// all-day entry on the due date itself.
function orderDueDateToIcsItem(order) {
  const hasTime = Boolean(order.delivery_due_time);
  return {
    uid: `order-due-${order.id}@swa.app`,
    title: `Order #${order.id} due — ${order.person_label}`,
    // A "YYYY-MM-DDTHH:mm" string with no timezone offset is parsed as
    // *local* time (same convention used throughout the renderer's
    // helpers.js) -- toISOString() then gives the correct UTC instant.
    start: hasTime ? new Date(`${order.delivery_due_date}T${order.delivery_due_time}`).toISOString() : order.delivery_due_date,
    allDay: !hasTime,
  };
}

async function saveIcsFile(icsText, defaultFileName, parentWindow) {
  const dialogOptions = {
    title: 'Export calendar',
    defaultPath: defaultFileName,
    filters: [{ name: 'iCalendar', extensions: ['ics'] }],
  };
  const { canceled, filePath } = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (canceled || !filePath) return null;

  fs.writeFileSync(filePath, icsText, 'utf8');
  return filePath;
}

async function pickIcsFile(parentWindow) {
  const dialogOptions = {
    title: 'Import calendar',
    filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    properties: ['openFile'],
  };
  const { canceled, filePaths } = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
}

function registerCalendarEventIpc() {
  ipcMain.handle('calendarEvent:listAll', () => calendarEventRepo.listAll());
  ipcMain.handle('calendarEvent:get', (_event, id) => calendarEventRepo.get(id));
  ipcMain.handle('calendarEvent:create', (_event, data) => calendarEventRepo.create(data));
  ipcMain.handle('calendarEvent:update', (_event, id, data) => calendarEventRepo.update(id, data));
  ipcMain.handle('calendarEvent:delete', (_event, id) => calendarEventRepo.remove(id));

  ipcMain.handle('calendarEvent:exportIcs', async (event, id) => {
    const calendarEvent = calendarEventRepo.get(id);
    if (!calendarEvent) throw new Error(`Calendar event ${id} not found.`);

    const icsText = buildIcs([eventToIcsItem(calendarEvent)]);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    return saveIcsFile(icsText, `event-${id}.ics`, parentWindow);
  });

  ipcMain.handle('calendarEvent:exportAllIcs', async (event) => {
    const events = calendarEventRepo.listAll().map(eventToIcsItem);
    const orderDueDates = orderRepo.listWithDeliveryDueDates().map(orderDueDateToIcsItem);

    const icsText = buildIcs([...events, ...orderDueDates]);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    return saveIcsFile(icsText, 'swa-calendar.ics', parentWindow);
  });

  // Single-order-due-date export -- the counterpart to exportIcs() above
  // for the automatic order-due entries (order.js's
  // listWithDeliveryDueDates()), which aren't real calendar_events rows
  // and so have no id of their own to export by. Reuses the same
  // buildIcs()/saveIcsFile()/orderDueDateToIcsItem() this file already
  // has for exportAllIcs() rather than a single-order-scoped query --
  // fine at this app's scale.
  ipcMain.handle('calendarEvent:exportOrderDueIcs', async (event, orderId) => {
    const order = orderRepo.listWithDeliveryDueDates().find((o) => o.id === orderId);
    if (!order) throw new Error('This order has no delivery due date set.');

    const icsText = buildIcs([orderDueDateToIcsItem(order)]);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    return saveIcsFile(icsText, `order-${orderId}-due.ics`, parentWindow);
  });

  // Every VEVENT in the chosen file becomes a new calendar_events row --
  // never auto-linked to an order (no way to infer that from an
  // external file) and never merged/matched against existing events
  // (a plain "bring these events in," not a two-way sync). See
  // icsImport.js for the parser and its documented limitations.
  ipcMain.handle('calendarEvent:importIcs', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const filePath = await pickIcsFile(parentWindow);
    if (!filePath) return null;

    const icsText = fs.readFileSync(filePath, 'utf8');
    const { items, skipped } = parseIcs(icsText);

    for (const item of items) {
      calendarEventRepo.create({
        title: item.title,
        notes: item.notes,
        startDatetime: item.start,
        endDatetime: item.end,
        allDay: item.allDay,
      });
    }

    return { imported: items.length, skipped };
  });
}

module.exports = { registerCalendarEventIpc };
