'use strict';

const fs = require('fs');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const connection = require('../db/connection');
const { restoreFromBackup } = require('../backup/restoreBackup');

// A backup file is a byte-for-byte copy of the live encrypted data.db --
// same encryption, same passphrase -- not a separate export format, so
// "create" is just a save-dialog + fs.copyFileSync (same shape as
// dataExchangeIpc.js's exportAndSave). The destructive "restore" side is
// isolated in src/main/backup/restoreBackup.js.

function defaultBackupFileName() {
  // e.g. SWA-backup-2026-09-04T17-05-32.swabackup -- sortable, and
  // unique enough per-second that repeated backups in a session don't
  // collide.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `SWA-backup-${stamp}.swabackup`;
}

function registerBackupIpc() {
  ipcMain.handle('backup:create', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      title: 'Create backup',
      defaultPath: defaultBackupFileName(),
      filters: [{ name: 'SWA Backup', extensions: ['swabackup'] }],
    };
    const { canceled, filePath } = parentWindow
      ? await dialog.showSaveDialog(parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (canceled || !filePath) return null;

    fs.copyFileSync(connection.getDbPath(), filePath);
    return filePath;
  });

  ipcMain.handle('backup:pickFile', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      title: 'Restore from backup',
      filters: [
        { name: 'SWA Backup', extensions: ['swabackup', 'db'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  ipcMain.handle('backup:restore', (_event, { filePath, passphrase }) => restoreFromBackup(filePath, passphrase));
}

module.exports = { registerBackupIpc };
