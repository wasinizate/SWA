'use strict';

// The destructive half of local backup/restore (see backupIpc.js for the
// dialog-driven "Create backup" side, which is a plain fs.copyFileSync
// and doesn't need its own module). A backup file IS data.db -- a raw
// copy of the encrypted vault, not a JSON bundle like dataExchange/'s
// export format -- so restoring is a full-file replace, never a merge.
// Kept isolated here (rather than inline in the IPC handler) because
// it's the one piece of this feature worth testing on its own before
// wiring it up to a UI that can call it by mistake.

const fs = require('fs');
const connection = require('../db/connection');
const { runMigrations } = require('../db/migrate');

// Replaces the live vault with the contents of `backupFilePath`. Always
// makes an untouched, never-auto-deleted copy of today's data first
// (`<dbPath>.pre-restore-<timestamp>.bak`) so a mistaken or regretted
// restore is itself recoverable -- the path is returned so the caller
// can tell the user exactly where it went.
async function restoreFromBackup(backupFilePath, passphrase) {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error('Backup file not found.');
  }

  const dbPath = connection.getDbPath();

  // Two checks before anything destructive happens: the chosen file has
  // to actually be a valid encrypted database openable with this
  // passphrase, and that passphrase has to be *this* vault's real one --
  // catches "right file, wrong vault" (or a mistyped passphrase) with a
  // clean error and zero side effects, rather than relying on the
  // safety copy below to undo it.
  connection.verifyPassphraseAgainstFile(backupFilePath, passphrase);
  connection.verifyPassphraseAgainstFile(dbPath, passphrase);

  connection.close();

  const safetyCopyPath = `${dbPath}.pre-restore-${Date.now()}.bak`;
  fs.copyFileSync(dbPath, safetyCopyPath);

  fs.copyFileSync(backupFilePath, dbPath);

  // Passphrase already proven valid above, so this can't fail on that
  // account. runMigrations() brings an older backup's schema forward --
  // the same call every normal unlock already makes.
  connection.open(passphrase);
  runMigrations(connection.getDb());

  return { safetyCopyPath };
}

module.exports = { restoreFromBackup };
