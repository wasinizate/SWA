'use strict';

const { ipcMain } = require('electron');
const priceTemplateRepo = require('../db/repositories/priceTemplate');

function registerPriceTemplateIpc() {
  ipcMain.handle('priceTemplate:listAll', () => priceTemplateRepo.listAll());
  ipcMain.handle('priceTemplate:get', (_event, id) => priceTemplateRepo.get(id));
  ipcMain.handle('priceTemplate:create', (_event, data) => priceTemplateRepo.create(data));
  ipcMain.handle('priceTemplate:update', (_event, id, data) => priceTemplateRepo.update(id, data));
  ipcMain.handle('priceTemplate:delete', (_event, id) => priceTemplateRepo.remove(id));
}

module.exports = { registerPriceTemplateIpc };
