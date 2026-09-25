'use strict';

const { ipcMain } = require('electron');
const personRepo = require('../db/repositories/person');
const personDuplicatesRepo = require('../db/repositories/personDuplicates');

function registerPersonIpc() {
  ipcMain.handle('person:listAll', () => personRepo.listAll());
  ipcMain.handle('person:get', (_event, id) => personRepo.get(id));
  ipcMain.handle('person:create', (_event, data) => personRepo.create(data));
  ipcMain.handle('person:update', (_event, id, data) => personRepo.update(id, data));
  ipcMain.handle('person:delete', (_event, id) => personRepo.remove(id));
  ipcMain.handle('person:mergeInto', (_event, loserId, survivorId) => personRepo.mergeInto(loserId, survivorId));

  ipcMain.handle('person:findDuplicateCandidates', () => personDuplicatesRepo.findDuplicateCandidates());
}

module.exports = { registerPersonIpc };
