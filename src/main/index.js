'use strict';

// Main process entry point: app lifecycle, window creation, and wiring
// together the DB connection, IPC handlers, and the auto-lock timer.
//
// This app deliberately never calls electron's autoUpdater or
// crashReporter modules, and has no analytics/telemetry dependency
// anywhere in package.json -- see README.md's threat model for the full
// "what this does and doesn't protect against" writeup.

const { app, BrowserWindow } = require('electron');
const { createMainWindow } = require('./window');
const { registerVaultIpc } = require('./ipc/vaultIpc');
const { registerPersonIpc } = require('./ipc/personIpc');
const { registerPlatformAccountIpc } = require('./ipc/platformAccountIpc');
const { registerOrderIpc } = require('./ipc/orderIpc');
const { registerOrderAttachmentIpc } = require('./ipc/orderAttachmentIpc');
const { registerCalendarEventIpc } = require('./ipc/calendarEventIpc');
const { registerSettingsIpc } = require('./ipc/settingsIpc');
const idleLock = require('./security/idleLock');
const reminderScheduler = require('./reminders/reminderScheduler');
const connection = require('./db/connection');
const settingsRepo = require('./db/repositories/settings');

// Windows ties desktop notifications to an "AppUserModelID" -- without
// setting one, Notification.isSupported() can still report true while
// the OS quietly declines to actually display anything. Matches
// electron-builder.yml's appId so a packaged build and this dev run
// behave the same way. Harmless no-op on macOS/Linux.
app.setAppUserModelId('com.example.localcrm');

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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vault:locked', { reason });
  }
}

// Called whenever the vault transitions to unlocked (first-time setup,
// normal unlock, or quick unlock).
function notifyUnlocked() {
  idleLock.start(getIdleTimeoutSeconds, notifyLocked);
  reminderScheduler.start(() => mainWindow);
}

app.whenReady().then(() => {
  registerVaultIpc({ onUnlocked: notifyUnlocked, onLocked: notifyLocked });
  registerPersonIpc();
  registerPlatformAccountIpc();
  registerOrderIpc();
  registerOrderAttachmentIpc();
  registerCalendarEventIpc();
  registerSettingsIpc();

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
  connection.close();
  if (process.platform !== 'darwin') app.quit();
});
