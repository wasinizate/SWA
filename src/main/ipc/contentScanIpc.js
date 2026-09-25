'use strict';

const fs = require('fs');
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const settingsRepo = require('../db/repositories/settings');
const contentScanner = require('../scanner/contentScanner');

function registerContentScanIpc() {
  ipcMain.handle('contentScan:getRootPath', () => settingsRepo.getContentLibraryRootPath());

  // Combines "choose a folder" + "remember it" in one call, same shape
  // as syncIpc.js's sync:pickFolder.
  ipcMain.handle('contentScan:pickRootPath', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = { title: 'Choose content library folder', properties: ['openDirectory'] };
    const { canceled, filePaths } = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (canceled || filePaths.length === 0) return null;
    settingsRepo.setContentLibraryRootPath(filePaths[0]);
    return filePaths[0];
  });

  ipcMain.handle('contentScan:run', async () => {
    const rootPath = settingsRepo.getContentLibraryRootPath();
    if (!rootPath) throw new Error('Choose a library folder first.');
    return contentScanner.scanLibrary(rootPath);
  });

  // Opens any path in the OS file manager -- not scan-specific, works
  // from a manually-typed Location too (see contentDetail.js's "Open
  // folder" button). shell.openPath() resolves with an error string on
  // failure rather than rejecting, per Electron's own convention here.
  //
  // Folders open in the file manager; a *file* location is revealed in
  // its folder instead of opened, since shell.openPath() on a file runs
  // it -- an .exe or script typed into Location would execute.
  ipcMain.handle('contentScan:openPath', async (_event, targetPath) => {
    if (!targetPath) return;
    let stats;
    try {
      stats = fs.statSync(targetPath);
    } catch {
      throw new Error("That location doesn't exist (moved, renamed, or its drive isn't connected).");
    }
    if (!stats.isDirectory()) {
      shell.showItemInFolder(targetPath);
      return;
    }
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) throw new Error(errorMessage);
  });
}

module.exports = { registerContentScanIpc };
