'use strict';

const { ipcMain } = require('electron');
const platformAccountRepo = require('../db/repositories/platformAccount');

function registerPlatformAccountIpc() {
  ipcMain.handle('platformAccount:listByPerson', (_event, personId) => platformAccountRepo.listByPerson(personId));
  ipcMain.handle('platformAccount:create', (_event, data) => platformAccountRepo.create(data));
  ipcMain.handle('platformAccount:update', (_event, id, data) => platformAccountRepo.update(id, data));
  ipcMain.handle('platformAccount:delete', (_event, id) => platformAccountRepo.remove(id));
}

module.exports = { registerPlatformAccountIpc };
