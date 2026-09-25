'use strict';

// Automatic daily backups into a folder the user picks (Settings -> Backup
// & restore). Each one is the same thing "Create backup" makes: a byte-for-
// byte copy of the encrypted data.db (see backupIpc.js), so nothing new is
// exposed -- a backup is only as readable as the vault passphrase allows.
//
// A plain file copy is a consistent snapshot here: the database uses
// SQLite's default rollback journal (not WAL), and better-sqlite3 runs
// every statement synchronously on this same thread, so no write can be
// half-finished while copyFileSync runs.
//
// Pruning only ever touches files this module named (AUTO_PREFIX...), so
// pointing it at a folder that holds other things -- including manual
// backups -- is safe.
//
// Same start/stop-on-unlock/lock pairing as idleLock.js and
// syncScheduler.js (see src/main/index.js).

const fs = require('fs');
const path = require('path');
const connection = require('../db/connection');
const settingsRepo = require('../db/repositories/settings');
const passphrase = require('../security/passphrase');

const AUTO_PREFIX = 'SWA-auto-';
const AUTO_EXTENSION = '.swabackup';
const POLL_INTERVAL_MS = 60 * 60 * 1000;
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;

let pollHandle = null;

// Local time, sortable, filename-safe: SWA-auto-2026-09-25_0412.swabackup
function autoBackupFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${AUTO_PREFIX}${stamp}${AUTO_EXTENSION}`;
}

function listAutoBackups(folderPath) {
  return fs
    .readdirSync(folderPath)
    .filter((name) => name.startsWith(AUTO_PREFIX) && name.endsWith(AUTO_EXTENSION))
    .sort(); // timestamped names sort oldest -> newest
}

function pruneAutoBackups(folderPath, keep) {
  const files = listAutoBackups(folderPath);
  const toDelete = files.slice(0, Math.max(0, files.length - keep));
  for (const name of toDelete) fs.rmSync(path.join(folderPath, name));
  return toDelete.length;
}

// Makes one automatic backup right now, regardless of when the last one
// was. Records the outcome either way, so Settings can show a failure
// (most often: the chosen folder is on a drive that isn't plugged in).
function runAutoBackupNow() {
  const { folderPath, keep } = settingsRepo.getAutoBackupSettings();
  try {
    if (!folderPath) throw new Error('Choose a backup folder first.');
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      throw new Error(`Backup folder not found: ${folderPath}`);
    }
    const target = path.join(folderPath, autoBackupFileName());
    fs.copyFileSync(connection.getDbPath(), target);
    const now = new Date().toISOString();
    settingsRepo.recordAutoBackupResult({ at: now, error: '' });
    settingsRepo.setLastBackupAt(now);
    pruneAutoBackups(folderPath, keep);
    return { ok: true, filePath: target };
  } catch (err) {
    settingsRepo.recordAutoBackupResult({ error: err.message });
    return { ok: false, error: err.message };
  }
}

function isDue() {
  const { enabled, folderPath, lastAutoBackupAt } = settingsRepo.getAutoBackupSettings();
  if (!enabled || !folderPath) return false;
  if (!lastAutoBackupAt) return true;
  return Date.now() - new Date(lastAutoBackupAt).getTime() >= BACKUP_EVERY_MS;
}

function runIfDue() {
  if (!passphrase.isUnlocked() || !connection.isOpen()) return;
  if (isDue()) runAutoBackupNow();
}

// First check shortly after unlocking (a vault that's only opened briefly
// each day still gets its daily backup) -- delayed a little so a large
// database's synchronous copy doesn't freeze the app while it's still
// opening -- then hourly while unlocked.
const FIRST_CHECK_DELAY_MS = 15_000;
let firstCheckHandle = null;

function start() {
  stop();
  firstCheckHandle = setTimeout(runIfDue, FIRST_CHECK_DELAY_MS);
  pollHandle = setInterval(runIfDue, POLL_INTERVAL_MS);
}

function stop() {
  clearTimeout(firstCheckHandle);
  firstCheckHandle = null;
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

module.exports = { start, stop, runAutoBackupNow, pruneAutoBackups, listAutoBackups, autoBackupFileName, isDue, AUTO_PREFIX };
