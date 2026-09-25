'use strict';

// Repository layer for `app_settings` (a generic key/value store -- see
// 0001_init.sql's comment). The only place that writes raw SQL for it.

const crypto = require('crypto');
const { getDb } = require('../connection');

const DEFAULT_IDLE_TIMEOUT_SECONDS = 600; // 10 minutes
const DEFAULT_ORDER_DUE_REMINDER_ENABLED = true;
const DEFAULT_ORDER_DUE_REMINDER_DAYS_BEFORE = 1;
const DEFAULT_SHOW_DUE_SUMMARY_ON_OPEN = true;
const DEFAULT_THEME = 'default';
const DEFAULT_QUIET_CLIENT_THRESHOLD_DAYS = 30;
const RECENTLY_VIEWED_LIMIT = 8;

// Small internal helpers shared by every setting below -- app_settings is
// a plain key/value table (see 0001_init.sql), so every getter/setter
// pair is the same two queries with a different key and default.
function getSetting(key, defaultValue) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function getIdleTimeoutSeconds() {
  return Number(getSetting('idle_timeout_seconds', DEFAULT_IDLE_TIMEOUT_SECONDS));
}

function setIdleTimeoutSeconds(seconds) {
  setSetting('idle_timeout_seconds', seconds);
}

function getOrderDueReminderEnabled() {
  return getSetting('order_due_reminder_enabled', DEFAULT_ORDER_DUE_REMINDER_ENABLED ? '1' : '0') === '1';
}

function setOrderDueReminderEnabled(enabled) {
  setSetting('order_due_reminder_enabled', enabled ? '1' : '0');
}

function getOrderDueReminderDaysBefore() {
  return Number(getSetting('order_due_reminder_days_before', DEFAULT_ORDER_DUE_REMINDER_DAYS_BEFORE));
}

function setOrderDueReminderDaysBefore(days) {
  setSetting('order_due_reminder_days_before', days);
}

function getShowDueSummaryOnOpen() {
  return getSetting('show_due_summary_on_open', DEFAULT_SHOW_DUE_SUMMARY_ON_OPEN ? '1' : '0') === '1';
}

function setShowDueSummaryOnOpen(enabled) {
  setSetting('show_due_summary_on_open', enabled ? '1' : '0');
}

// The renderer validates the theme id against its own known list (see
// renderer/theme.js) before ever applying it -- this just stores
// whatever string it's given, same as every other setting here.
function getTheme() {
  return getSetting('theme', DEFAULT_THEME);
}

function setTheme(theme) {
  setSetting('theme', theme);
}

// Freeform text for the Dashboard's notes scratchpad -- not tied to any
// client/order, just one more small piece of app state, same reasoning
// as everything else in this table (see 0001_init.sql's comment).
function getDashboardNote() {
  return getSetting('dashboard_note', '');
}

function setDashboardNote(note) {
  setSetting('dashboard_note', note);
}

// Recently viewed clients, for the sidebar's "Recently viewed" list --
// stored as a JSON array of ids, most-recent-first, same key/value
// table as everything else here rather than a dedicated table for
// something this small. Capped at RECENTLY_VIEWED_LIMIT on every write,
// not just on read, so the stored value itself never grows unbounded.
function getRecentlyViewedPersonIds() {
  try {
    const ids = JSON.parse(getSetting('recently_viewed_person_ids', '[]'));
    return Array.isArray(ids) ? ids : [];
  } catch (err) {
    return []; // corrupted/hand-edited value -- fail soft, not a crash
  }
}

function recordPersonView(personId) {
  const withoutThisOne = getRecentlyViewedPersonIds().filter((id) => id !== personId);
  const updated = [personId, ...withoutThisOne].slice(0, RECENTLY_VIEWED_LIMIT);
  setSetting('recently_viewed_person_ids', JSON.stringify(updated));
}

// Resolves stored ids to { id, private_label } pairs, most-recent-first,
// silently dropping any id that no longer resolves to a real person
// (deleted, or merged away as the losing side of person.js's
// mergeInto()) -- simpler and more robust than trying to proactively
// scrub this list from every place a person can disappear.
function getRecentlyViewedPersons() {
  const db = getDb();
  return getRecentlyViewedPersonIds()
    .map((id) => db.prepare('SELECT id, private_label FROM persons WHERE id = ?').get(id))
    .filter(Boolean);
}

// How many days without a new order before the Clients list/Dashboard
// flag a client as "haven't heard from" -- see order.js's
// listLastOrderDateByPerson(), which supplies the other half of that
// comparison.
function getQuietClientThresholdDays() {
  return Number(getSetting('quiet_client_threshold_days', DEFAULT_QUIET_CLIENT_THRESHOLD_DAYS));
}

function setQuietClientThresholdDays(days) {
  setSetting('quiet_client_threshold_days', days);
}

// ---- Shared-folder sync (see src/main/sync/) -------------------------

// This instance's stable identity -- lets the sync scanner recognize
// and skip files it wrote itself when scanning the shared folder for
// *other* instances' exports. Minted once, on first use, and persisted
// -- never regenerated after (a change here would make every remote
// instance treat this one as brand new).
function getSyncInstanceId() {
  const existing = getSetting('sync_instance_id', null);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  setSetting('sync_instance_id', generated);
  return generated;
}

function getSyncFolderPath() {
  return getSetting('sync_folder_path', '');
}

function setSyncFolderPath(folderPath) {
  setSetting('sync_folder_path', folderPath || '');
}

function getSyncEnabled() {
  return getSetting('sync_enabled', '0') === '1';
}

function setSyncEnabled(enabled) {
  setSetting('sync_enabled', enabled ? '1' : '0');
}

// The safeStorage-wrapped sync passphrase blob (base64) -- see
// src/main/sync/syncPassphrase.js, the only module that ever handles
// the raw passphrase. This is just the key/value slot it's stored in,
// same as every other setting here.
function getSyncPassphraseBlob() {
  return getSetting('sync_passphrase_blob', null);
}

function setSyncPassphraseBlob(blob) {
  setSetting('sync_passphrase_blob', blob || '');
}

// ---- Content library media scanner (see src/main/scanner/) -----------

// The one root folder the scanner walks -- same "pick once, remember
// it" shape as getSyncFolderPath()/setSyncFolderPath() above.
// ---- Automatic backups (see src/main/backup/autoBackup.js) -------------

const DEFAULT_AUTO_BACKUP_KEEP = 7;

function getAutoBackupSettings() {
  return {
    enabled: getSetting('auto_backup_enabled', '0') === '1',
    folderPath: getSetting('auto_backup_folder', ''),
    keep: Number(getSetting('auto_backup_keep', DEFAULT_AUTO_BACKUP_KEEP)) || DEFAULT_AUTO_BACKUP_KEEP,
    lastAutoBackupAt: getSetting('last_auto_backup_at', null),
    lastError: getSetting('auto_backup_last_error', ''),
  };
}

function setAutoBackupEnabled(enabled) {
  setSetting('auto_backup_enabled', enabled ? '1' : '0');
}

function setAutoBackupFolder(folderPath) {
  setSetting('auto_backup_folder', folderPath || '');
}

function setAutoBackupKeep(keep) {
  setSetting('auto_backup_keep', String(keep));
}

function recordAutoBackupResult({ at, error }) {
  if (at) setSetting('last_auto_backup_at', at);
  setSetting('auto_backup_last_error', error || '');
}

// Most recent backup of either kind (manual "Create backup" or automatic)
// -- what the Dashboard's "Last backup" reminder is about.
function getLastBackupAt() {
  return getSetting('last_backup_at', null);
}

function setLastBackupAt(isoString) {
  setSetting('last_backup_at', isoString);
}

function getContentLibraryRootPath() {
  return getSetting('content_library_root_path', '');
}

function setContentLibraryRootPath(folderPath) {
  setSetting('content_library_root_path', folderPath || '');
}

// ---- Network access lock (see src/main/security/networkGuard.js) -----

// Master switch for every network-capable feature in the app -- locked
// (false) by default, so SWA makes zero network requests until this is
// deliberately turned on in Settings -> Privacy. Every network call
// site (today: "Check for updates"; later: any cloud sync feature)
// checks this via networkGuard.assertNetworkAllowed() before making a
// request, not just the UI.
const DEFAULT_NETWORK_ACCESS_ENABLED = false;

function getNetworkAccessEnabled() {
  return getSetting('network_access_enabled', DEFAULT_NETWORK_ACCESS_ENABLED ? '1' : '0') === '1';
}

function setNetworkAccessEnabled(enabled) {
  setSetting('network_access_enabled', enabled ? '1' : '0');
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  getIdleTimeoutSeconds,
  setIdleTimeoutSeconds,
  getOrderDueReminderEnabled,
  setOrderDueReminderEnabled,
  getOrderDueReminderDaysBefore,
  setOrderDueReminderDaysBefore,
  getShowDueSummaryOnOpen,
  setShowDueSummaryOnOpen,
  DEFAULT_THEME,
  getTheme,
  setTheme,
  getDashboardNote,
  setDashboardNote,
  recordPersonView,
  getRecentlyViewedPersons,
  getQuietClientThresholdDays,
  setQuietClientThresholdDays,
  getSyncInstanceId,
  DEFAULT_AUTO_BACKUP_KEEP,
  getAutoBackupSettings,
  setAutoBackupEnabled,
  setAutoBackupFolder,
  setAutoBackupKeep,
  recordAutoBackupResult,
  getLastBackupAt,
  setLastBackupAt,
  getSyncFolderPath,
  setSyncFolderPath,
  getSyncEnabled,
  setSyncEnabled,
  getSyncPassphraseBlob,
  setSyncPassphraseBlob,
  getContentLibraryRootPath,
  setContentLibraryRootPath,
  getNetworkAccessEnabled,
  setNetworkAccessEnabled,
};
