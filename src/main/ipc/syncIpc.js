'use strict';

const { ipcMain, dialog, BrowserWindow } = require('electron');
const settingsRepo = require('../db/repositories/settings');
const syncPassphraseStore = require('../sync/syncPassphrase');
const syncScheduler = require('../sync/syncScheduler');
const syncSeenRepo = require('../db/repositories/syncSeen');
const { applyImport } = require('../dataExchange/applyImport');

function registerSyncIpc() {
  ipcMain.handle('sync:getStatus', () => ({
    enabled: settingsRepo.getSyncEnabled(),
    folderPath: settingsRepo.getSyncFolderPath(),
    hasPassphrase: syncPassphraseStore.hasSyncPassphrase(),
    instanceId: settingsRepo.getSyncInstanceId(),
    pendingCount: syncScheduler.listPending().length,
  }));

  ipcMain.handle('sync:setEnabled', (_event, enabled) => {
    settingsRepo.setSyncEnabled(enabled);
    return enabled;
  });

  // "Sync now" button -- runs one cycle immediately instead of waiting on
  // the 15-minute background poll (see syncScheduler.js's runNow()).
  // Throws (surfaced as a toast) if a folder/passphrase isn't set up yet.
  ipcMain.handle('sync:runNow', () => syncScheduler.runNow());

  // Combines "choose a folder" + "remember it" in one call, same shape
  // as dataExchangeIpc.js's exportAndSave combining dialog + write.
  ipcMain.handle('sync:pickFolder', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = { title: 'Choose sync folder', properties: ['openDirectory', 'createDirectory'] };
    const { canceled, filePaths } = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (canceled || filePaths.length === 0) return null;
    settingsRepo.setSyncFolderPath(filePaths[0]);
    return filePaths[0];
  });

  ipcMain.handle('sync:setPassphrase', (_event, passphrase) => {
    syncPassphraseStore.setSyncPassphrase(passphrase);
    return true;
  });

  ipcMain.handle('sync:clearPassphrase', () => {
    syncPassphraseStore.clearSyncPassphrase();
    return true;
  });

  // Each pending item's cached preview (computed once, when the
  // scheduler first noticed it -- see syncScheduler.js) already carries
  // everything the UI needs, including the "attach to existing client /
  // create new" picker list for an unresolved one (previewImport()'s
  // `people` field) -- no separate re-preview call needed.
  ipcMain.handle('sync:listPending', () => syncScheduler.listPending().map((p) => ({ id: p.id, preview: p.preview })));

  ipcMain.handle('sync:applyPending', (_event, id, resolution) => {
    const item = syncScheduler.getPending(id);
    if (!item) throw new Error('This sync update is no longer pending -- it may have already been applied or dismissed.');

    const result = applyImport(item.bundle, resolution);
    syncSeenRepo.markSeen(item.sourceInstanceId, item.personExternalId, item.bundle.exportedAt);
    syncScheduler.resolvePending(id);
    return result;
  });

  ipcMain.handle('sync:dismissPending', (_event, id) => {
    const item = syncScheduler.getPending(id);
    if (!item) return false;

    syncSeenRepo.markSeen(item.sourceInstanceId, item.personExternalId, item.bundle.exportedAt);
    syncScheduler.resolvePending(id);
    return true;
  });
}

module.exports = { registerSyncIpc };
