'use strict';

const fs = require('fs');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const calendarEventRepo = require('../db/repositories/calendarEvent');
const orderRepo = require('../db/repositories/order');
const { buildIcs } = require('../calendar/icsExport');

// Converts one calendar_events row into buildIcs()'s item shape.
function eventToIcsItem(event) {
  return {
    uid: `event-${event.id}@swa.app`,
    title: event.title,
    notes: event.notes,
    start: event.start_datetime,
    end: event.end_datetime,
    allDay: !!event.all_day,
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
}

module.exports = { registerCalendarEventIpc };
