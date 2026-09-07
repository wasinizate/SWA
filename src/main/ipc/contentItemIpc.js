'use strict';

const { ipcMain } = require('electron');
const contentItemRepo = require('../db/repositories/contentItem');
const contentItemFileRepo = require('../db/repositories/contentItemFile');

function registerContentItemIpc() {
  ipcMain.handle('contentItem:listAll', () => contentItemRepo.listAll());
  ipcMain.handle('contentItem:get', (_event, id) => contentItemRepo.get(id));
  ipcMain.handle('contentItem:create', (_event, data) => contentItemRepo.create(data));
  ipcMain.handle('contentItem:update', (_event, id, data) => contentItemRepo.update(id, data));
  ipcMain.handle('contentItem:delete', (_event, id) => contentItemRepo.remove(id));

  ipcMain.handle('contentItem:listTagsFor', (_event, contentItemId) => contentItemRepo.listTagsFor(contentItemId));
  ipcMain.handle('contentItem:addTag', (_event, contentItemId, label) => contentItemRepo.addTag(contentItemId, label));
  ipcMain.handle('contentItem:removeTag', (_event, contentItemId, tagId) => contentItemRepo.removeTag(contentItemId, tagId));

  ipcMain.handle('contentItem:listForOrder', (_event, orderId) => contentItemRepo.listForOrder(orderId));
  ipcMain.handle('contentItem:addToOrder', (_event, orderId, contentItemId) => contentItemRepo.addToOrder(orderId, contentItemId));
  ipcMain.handle('contentItem:removeFromOrder', (_event, orderId, contentItemId) =>
    contentItemRepo.removeFromOrder(orderId, contentItemId)
  );
  ipcMain.handle('contentItem:setPricePaid', (_event, orderId, contentItemId, priceCents) =>
    contentItemRepo.setPricePaid(orderId, contentItemId, priceCents)
  );
  ipcMain.handle('contentItem:findByTitle', (_event, title) => contentItemRepo.findByTitle(title));

  ipcMain.handle('contentItem:getSalesDetail', (_event, contentItemId) => contentItemRepo.getSalesDetail(contentItemId));

  // See src/main/scanner/contentScanner.js -- content_item_files is
  // populated by the scanner, this just reads it back for the detail
  // page's Files card. setFilePrices is the one field on that table a
  // user edits by hand rather than the scanner discovering it.
  ipcMain.handle('contentItem:listFiles', (_event, contentItemId) => contentItemFileRepo.listFor(contentItemId));
  ipcMain.handle('contentItem:setFilePrices', (_event, contentItemId, updates) =>
    contentItemFileRepo.setPrices(contentItemId, updates)
  );
}

module.exports = { registerContentItemIpc };
