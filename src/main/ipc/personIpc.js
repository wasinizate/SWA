'use strict';

const { ipcMain } = require('electron');
const personRepo = require('../db/repositories/person');

function registerPersonIpc() {
  ipcMain.handle('person:listAll', () => personRepo.listAll());
  ipcMain.handle('person:get', (_event, id) => personRepo.get(id));
  ipcMain.handle('person:create', (_event, data) => personRepo.create(data));
  ipcMain.handle('person:update', (_event, id, data) => personRepo.update(id, data));
  ipcMain.handle('person:delete', (_event, id) => personRepo.remove(id));
}

module.exports = { registerPersonIpc };
