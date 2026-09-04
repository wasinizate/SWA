'use strict';

// Main process entry point: app lifecycle, window creation, and wiring
// together the DB connection, IPC handlers, and the auto-lock timer.
//
// This app deliberately never calls electron's autoUpdater or
// crashReporter modules, and has no analytics/telemetry dependency
// anywhere in package.json. The one exception to "no network calls" is
// updates/checkForUpdates.js -- a manual, opt-in, Settings-triggered
// version check against GitHub's public API, never automatic. See
// README.md's threat model for the full writeup.

const { app, BrowserWindow } = require('electron');
const { createMainWindow } = require('./window');
const { installMacMenu } = require('./menu');
const { registerVaultIpc } = require('./ipc/vaultIpc');
const { registerPersonIpc } = require('./ipc/personIpc');
const { registerPlatformAccountIpc } = require('./ipc/platformAccountIpc');
const { registerTagIpc } = require('./ipc/tagIpc');
const { registerPriceTemplateIpc } = require('./ipc/priceTemplateIpc');
const { registerOrderIpc } = require('./ipc/orderIpc');
const { registerOrderAttachmentIpc } = require('./ipc/orderAttachmentIpc');
const { registerCalendarEventIpc } = require('./ipc/calendarEventIpc');
const { registerSearchIpc } = require('./ipc/searchIpc');
const { registerExpenseIpc } = require('./ipc/expenseIpc');
const { registerIncomeStatementIpc } = require('./ipc/incomeStatementIpc');
const { registerIncomeStatementAttachmentIpc } = require('./ipc/incomeStatementAttachmentIpc');
const { registerDataExchangeIpc } = require('./ipc/dataExchangeIpc');
const { registerSettingsIpc } = require('./ipc/settingsIpc');
const { registerUpdateIpc } = require('./ipc/updateIpc');
const { registerSyncIpc } = require('./ipc/syncIpc');
const { registerBackupIpc } = require('./ipc/backupIpc');
const idleLock = require('./security/idleLock');
const reminderScheduler = require('./reminders/reminderScheduler');
const syncScheduler = require('./sync/syncScheduler');
const connection = require('./db/connection');
const settingsRepo = require('./db/repositories/settings');

// Windows ties desktop notifications to an "AppUserModelID" -- without
// setting one, Notification.isSupported() can still report true while
// the OS quietly declines to actually display anything. Matches
// electron-builder.yml's appId so a packaged build and this dev run
// behave the same way. Harmless no-op on macOS/Linux.
app.setAppUserModelId('com.wasinizate.swa');

let mainWindow = null;

function getIdleTimeoutSeconds() {
  if (!connection.isOpen()) return settingsRepo.DEFAULT_IDLE_TIMEOUT_SECONDS;
  return settingsRepo.getIdleTimeoutSeconds();
}

// Called whenever the vault transitions to locked, whether that's the
// idle timer firing or the user clicking "Lock now".
function notifyLocked(reason) {
  idleLock.stop();
  reminderScheduler.stop();
  syncScheduler.stop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vault:locked', { reason });
  }
}

// Called whenever the vault transitions to unlocked (first-time setup,
// normal unlock, or quick unlock).
function notifyUnlocked() {
  idleLock.start(getIdleTimeoutSeconds, notifyLocked);
  reminderScheduler.start(() => mainWindow);
  syncScheduler.start(() => mainWindow);
}

app.whenReady().then(() => {
  installMacMenu();

  registerVaultIpc({ onUnlocked: notifyUnlocked, onLocked: notifyLocked });
  registerPersonIpc();
  registerPlatformAccountIpc();
  registerTagIpc();
  registerPriceTemplateIpc();
  registerOrderIpc();
  registerOrderAttachmentIpc();
  registerCalendarEventIpc();
  registerSearchIpc();
  registerExpenseIpc();
  registerIncomeStatementIpc();
  registerIncomeStatementAttachmentIpc();
  registerDataExchangeIpc();
  registerSettingsIpc();
  registerUpdateIpc();
  registerSyncIpc();
  registerBackupIpc();

  mainWindow = createMainWindow();

  app.on('activate', () => {
    // macOS-style behavior: re-create a window if the dock icon is
    // clicked with no windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  idleLock.stop();
  reminderScheduler.stop();
  syncScheduler.stop();
  connection.close();
  if (process.platform !== 'darwin') app.quit();
});
