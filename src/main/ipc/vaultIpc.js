'use strict';

const { ipcMain } = require('electron');
const passphrase = require('../security/passphrase');

// onUnlocked/onLocked let main/index.js hook in the idle-lock timer and
// push a "vault:locked" event to the renderer without this module needing
// to know about BrowserWindow directly.
function registerVaultIpc({ onUnlocked, onLocked }) {
  ipcMain.handle('vault:status', () => passphrase.status());

  ipcMain.handle('vault:setup', (_event, plainPassphrase) => {
    passphrase.setup(plainPassphrase);
    onUnlocked();
    return passphrase.status();
  });

  ipcMain.handle('vault:unlock', (_event, plainPassphrase) => {
    passphrase.unlock(plainPassphrase);
    onUnlocked();
    return passphrase.status();
  });

  ipcMain.handle('vault:quickUnlock', () => {
    const ok = passphrase.tryQuickUnlock();
    if (ok) onUnlocked();
    return { ok, status: passphrase.status() };
  });

  ipcMain.handle('vault:lock', () => {
    passphrase.lock();
    onLocked('manual');
    return passphrase.status();
  });

  ipcMain.handle('vault:changePassphrase', (_event, newPassphrase) => {
    const { recoveryCleared } = passphrase.changePassphrase(newPassphrase);
    return { ...passphrase.status(), recoveryCleared };
  });

  ipcMain.handle('vault:setQuickUnlock', (_event, { enabled, currentPassphrase }) => {
    passphrase.setQuickUnlock(enabled, currentPassphrase);
    return passphrase.status();
  });

  ipcMain.handle('vault:generateRecoveryPhrase', (_event, currentPassphrase) => {
    const words = passphrase.generateRecoveryPhrase(currentPassphrase);
    return { words, status: passphrase.status() };
  });

  ipcMain.handle('vault:clearRecoveryPhrase', () => {
    passphrase.clearRecoveryPhrase();
    return passphrase.status();
  });

  ipcMain.handle('vault:recoverWithPhrase', (_event, words) => {
    passphrase.recoverWithPhrase(words);
    onUnlocked();
    return passphrase.status();
  });
}

module.exports = { registerVaultIpc };
