'use strict';

const fs = require('fs');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const personRepo = require('../db/repositories/person');
const { buildPersonExport } = require('../dataExchange/buildExportBundle');
const { encryptExport } = require('../dataExchange/encryptExport');
const { decryptExport } = require('../dataExchange/decryptExport');
const { previewImport, applyImport } = require('../dataExchange/applyImport');

// Shared by both export handlers below -- builds, encrypts, and prompts
// a save location, same save-dialog pattern as exportOrderPdf.js/
// orderAttachmentIpc.js's saveToDisk.
async function exportAndSave({ personId, orderIds, passphrase, parentWindow }) {
  const bundle = buildPersonExport(personId, { orderIds });
  const encrypted = encryptExport(bundle, passphrase);

  const person = personRepo.get(personId);
  const safeLabel = (person?.private_label || 'client').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const dialogOptions = {
    title: 'Export to file',
    defaultPath: `${safeLabel}.swaexport`,
    filters: [{ name: 'SWA Export', extensions: ['swaexport'] }],
  };
  const { canceled, filePath } = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (canceled || !filePath) return null;

  fs.writeFileSync(filePath, encrypted);
  return filePath;
}

function registerDataExchangeIpc() {
  ipcMain.handle('dataExchange:exportPerson', (event, { personId, passphrase }) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    return exportAndSave({ personId, orderIds: null, passphrase, parentWindow });
  });

  ipcMain.handle('dataExchange:exportOrder', (event, { orderId, personId, passphrase }) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    return exportAndSave({ personId, orderIds: [orderId], passphrase, parentWindow });
  });

  ipcMain.handle('dataExchange:previewImport', (_event, { fileContents, passphrase }) => {
    const bundle = decryptExport(fileContents, passphrase);
    return previewImport(bundle);
  });

  ipcMain.handle('dataExchange:applyImport', (_event, { fileContents, passphrase, resolution }) => {
    const bundle = decryptExport(fileContents, passphrase);
    return applyImport(bundle, resolution);
  });
}

module.exports = { registerDataExchangeIpc };
