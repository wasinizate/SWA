'use strict';

const { ipcMain } = require('electron');
const personInteractionRepo = require('../db/repositories/personInteraction');

function registerPersonInteractionIpc() {
  ipcMain.handle('personInteraction:listForPerson', (_event, personId) => personInteractionRepo.listForPerson(personId));
  ipcMain.handle('personInteraction:create', (_event, personId, data) => personInteractionRepo.create(personId, data));
  ipcMain.handle('personInteraction:remove', (_event, id) => personInteractionRepo.remove(id));
  ipcMain.handle('personInteraction:resolveFollowUp', (_event, id) => personInteractionRepo.resolveFollowUp(id));

  ipcMain.handle('personInteraction:getFollowUpSummary', () => personInteractionRepo.getFollowUpSummary());
  ipcMain.handle('personInteraction:getOpenFollowUpCount', () => personInteractionRepo.getOpenFollowUpCount());
}

module.exports = { registerPersonInteractionIpc };
