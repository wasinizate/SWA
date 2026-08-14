'use strict';

const { ipcMain } = require('electron');
const incomeStatementRepo = require('../db/repositories/incomeStatement');

function registerIncomeStatementIpc() {
  ipcMain.handle('incomeStatement:listAll', () => incomeStatementRepo.listAll());
  ipcMain.handle('incomeStatement:get', (_event, id) => incomeStatementRepo.get(id));
  ipcMain.handle('incomeStatement:create', (_event, data) => incomeStatementRepo.create(data));
  ipcMain.handle('incomeStatement:update', (_event, id, data) => incomeStatementRepo.update(id, data));
  ipcMain.handle('incomeStatement:delete', (_event, id) => incomeStatementRepo.remove(id));
  ipcMain.handle('incomeStatement:getTotals', () => incomeStatementRepo.getTotals());
}

module.exports = { registerIncomeStatementIpc };
