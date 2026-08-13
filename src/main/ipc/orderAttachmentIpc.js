'use strict';

const fs = require('fs');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const orderAttachmentRepo = require('../db/repositories/orderAttachment');

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB -- generous for screenshots, keeps the encrypted DB from bloating

function registerOrderAttachmentIpc() {
  ipcMain.handle('orderAttachment:listByOrder', (_event, orderId) => orderAttachmentRepo.listByOrder(orderId));

  ipcMain.handle('orderAttachment:add', (_event, { orderId, fileName, mimeType, data }) => {
    // `data` arrives as a Uint8Array over IPC (structured clone handles
    // binary data natively -- no base64 needed); better-sqlite3 wants a
    // real Node Buffer for a BLOB column.
    const buffer = Buffer.from(data);
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`"${fileName}" is too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). The limit is 20MB per file.`);
    }
    return orderAttachmentRepo.create({ orderId, fileName, mimeType, data: buffer });
  });

  ipcMain.handle('orderAttachment:get', (_event, id) => {
    const attachment = orderAttachmentRepo.get(id);
    if (!attachment) throw new Error(`Attachment ${id} not found.`);
    return attachment;
  });

  ipcMain.handle('orderAttachment:delete', (_event, id) => orderAttachmentRepo.remove(id));

  ipcMain.handle('orderAttachment:saveToDisk', async (event, id) => {
    const attachment = orderAttachmentRepo.get(id);
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

module.exports = { registerOrderAttachmentIpc };
