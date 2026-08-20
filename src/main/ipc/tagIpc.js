'use strict';

const { ipcMain } = require('electron');
const tagRepo = require('../db/repositories/tag');

function registerTagIpc() {
  ipcMain.handle('tag:listAll', () => tagRepo.listAll());
  ipcMain.handle('tag:listForPerson', (_event, personId) => tagRepo.listForPerson(personId));
  ipcMain.handle('tag:listGroupedByPerson', () => tagRepo.listGroupedByPerson());
  ipcMain.handle('tag:addToPerson', (_event, personId, label) => tagRepo.addToPerson(personId, label));
  ipcMain.handle('tag:removeFromPerson', (_event, personId, tagId) => tagRepo.removeFromPerson(personId, tagId));
}

module.exports = { registerTagIpc };
