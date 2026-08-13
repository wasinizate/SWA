'use strict';

const { ipcMain, BrowserWindow } = require('electron');
const orderRepo = require('../db/repositories/order');
const settingsRepo = require('../db/repositories/settings');
const { exportOrderPdf } = require('../pdf/exportOrderPdf');

function registerOrderIpc() {
  ipcMain.handle('order:listByPerson', (_event, personId) => orderRepo.listByPerson(personId));
  ipcMain.handle('order:listAll', () => orderRepo.listAll());
  ipcMain.handle('order:get', (_event, id) => orderRepo.get(id));
  ipcMain.handle('order:create', (_event, data) => orderRepo.create(data));
  ipcMain.handle('order:update', (_event, id, data) => orderRepo.update(id, data));
  ipcMain.handle('order:delete', (_event, id) => orderRepo.remove(id));
  ipcMain.handle('order:getTotalsByPerson', (_event, personId) => orderRepo.getTotalsByPerson(personId));
  ipcMain.handle('order:listWithDeliveryDueDates', () => orderRepo.listWithDeliveryDueDates());
  ipcMain.handle('order:getDueDateSummary', () => orderRepo.getDueDateSummary(settingsRepo.getOrderDueReminderDaysBefore()));
  ipcMain.handle('order:exportPdf', (event, orderId) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    return exportOrderPdf(orderId, parentWindow);
  });
}

module.exports = { registerOrderIpc };
