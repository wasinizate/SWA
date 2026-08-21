'use strict';

const { ipcMain } = require('electron');
const connection = require('../db/connection');
const settingsRepo = require('../db/repositories/settings');

// General app_settings-backed preferences. The idle-timeout handlers used
// to live in vaultIpc.js -- moved here now that there's a proper home for
// "app settings" separate from "vault lock state"; the channel names
// (and preload's window.api.vault.* surface) are unchanged, only the
// registration's location moved.
function registerSettingsIpc() {
  ipcMain.handle('vault:getIdleTimeoutSeconds', () => {
    if (!connection.isOpen()) return null;
    return settingsRepo.getIdleTimeoutSeconds();
  });

  ipcMain.handle('vault:setIdleTimeoutSeconds', (_event, seconds) => {
    settingsRepo.setIdleTimeoutSeconds(seconds);
    return seconds;
  });

  ipcMain.handle('settings:getOrderDueReminderConfig', () => {
    if (!connection.isOpen()) return null;
    return {
      enabled: settingsRepo.getOrderDueReminderEnabled(),
      daysBefore: settingsRepo.getOrderDueReminderDaysBefore(),
      showSummaryOnOpen: settingsRepo.getShowDueSummaryOnOpen(),
    };
  });

  ipcMain.handle('settings:setOrderDueReminderConfig', (_event, { enabled, daysBefore, showSummaryOnOpen }) => {
    settingsRepo.setOrderDueReminderEnabled(enabled);
    settingsRepo.setOrderDueReminderDaysBefore(daysBefore);
    settingsRepo.setShowDueSummaryOnOpen(showSummaryOnOpen);
    return { enabled, daysBefore, showSummaryOnOpen };
  });

  ipcMain.handle('settings:getTheme', () => {
    if (!connection.isOpen()) return null;
    return settingsRepo.getTheme();
  });

  ipcMain.handle('settings:setTheme', (_event, theme) => {
    settingsRepo.setTheme(theme);
    return theme;
  });

  ipcMain.handle('settings:getDashboardNote', () => {
    if (!connection.isOpen()) return null;
    return settingsRepo.getDashboardNote();
  });

  ipcMain.handle('settings:setDashboardNote', (_event, note) => {
    settingsRepo.setDashboardNote(note);
    return note;
  });

  ipcMain.handle('settings:getQuietClientThresholdDays', () => {
    if (!connection.isOpen()) return null;
    return settingsRepo.getQuietClientThresholdDays();
  });

  ipcMain.handle('settings:setQuietClientThresholdDays', (_event, days) => {
    settingsRepo.setQuietClientThresholdDays(days);
    return days;
  });
}

module.exports = { registerSettingsIpc };
