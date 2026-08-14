'use strict';

const fs = require('fs');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const incomeStatementAttachmentRepo = require('../db/repositories/incomeStatementAttachment');

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // keep in sync with orderAttachmentIpc.js's cap

function registerIncomeStatementAttachmentIpc() {
  ipcMain.handle('incomeStatementAttachment:listByStatement', (_event, incomeStatementId) =>
    incomeStatementAttachmentRepo.listByStatement(incomeStatementId)
  );

  ipcMain.handle('incomeStatementAttachment:add', (_event, { incomeStatementId, fileName, mimeType, data }) => {
    // `data` arrives as a Uint8Array over IPC -- see orderAttachmentIpc.js's
    // comment on the same conversion.
    const buffer = Buffer.from(data);
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`"${fileName}" is too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). The limit is 20MB per file.`);
    }
    return incomeStatementAttachmentRepo.create({ incomeStatementId, fileName, mimeType, data: buffer });
  });

  ipcMain.handle('incomeStatementAttachment:get', (_event, id) => {
    const attachment = incomeStatementAttachmentRepo.get(id);
    if (!attachment) throw new Error(`Attachment ${id} not found.`);
    return attachment;
  });

  ipcMain.handle('incomeStatementAttachment:delete', (_event, id) => incomeStatementAttachmentRepo.remove(id));

  ipcMain.handle('incomeStatementAttachment:saveToDisk', async (event, id) => {
    const attachment = incomeStatementAttachmentRepo.get(id);
    if (!attachment) throw new Error(`Attachment ${id} not found.`);

    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = { title: 'Save attachment', defaultPath: attachment.file_name };
    const { canceled, filePath } = parentWindow
      ? await dialog.showSaveDialog(parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (canceled || !filePath) return null;

    fs.writeFileSync(filePath, attachment.data);
    return filePath;
  });
}

module.exports = { registerIncomeStatementAttachmentIpc };
