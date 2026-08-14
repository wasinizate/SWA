'use strict';

const { ipcMain } = require('electron');
const expenseRepo = require('../db/repositories/expense');

function registerExpenseIpc() {
  ipcMain.handle('expense:listAll', () => expenseRepo.listAll());
  ipcMain.handle('expense:get', (_event, id) => expenseRepo.get(id));
  ipcMain.handle('expense:create', (_event, data) => expenseRepo.create(data));
  ipcMain.handle('expense:update', (_event, id, data) => expenseRepo.update(id, data));
  ipcMain.handle('expense:delete', (_event, id) => expenseRepo.remove(id));
  ipcMain.handle('expense:getTotals', () => expenseRepo.getTotals());
}

module.exports = { registerExpenseIpc };
