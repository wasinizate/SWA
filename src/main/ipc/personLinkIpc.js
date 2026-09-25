'use strict';

const { ipcMain } = require('electron');
const personLinkRepo = require('../db/repositories/personLink');

function registerPersonLinkIpc() {
  ipcMain.handle('personLink:listForPerson', (_event, personId) => personLinkRepo.listForPerson(personId));
  ipcMain.handle('personLink:create', (_event, personAId, personBId, note) => personLinkRepo.create(personAId, personBId, note));
  ipcMain.handle('personLink:remove', (_event, id) => personLinkRepo.remove(id));
}

module.exports = { registerPersonLinkIpc };
