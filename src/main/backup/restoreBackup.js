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
const Database = require('better-sqlite3-multiple-ciphers');
const connection = require('../db/connection');
const { runMigrations } = require('../db/migrate');

// Replaces the live vault with the contents of `backupFilePath`. Always
// makes an untouched, never-auto-deleted copy of today's data first
// (`<dbPath>.pre-restore-<timestamp>.bak`) so a mistaken or regretted
// restore is itself recoverable -- the path is returned so the caller
// can tell the user exactly where it went.
//
// `passphrase` is the vault's *current* one. A backup made before a
// passphrase change opens only with the passphrase in use back then, so
// `backupPassphrase` can differ: the restored copy is then re-encrypted
// (PRAGMA rekey) to the current passphrase before it replaces the vault,
// so the vault's passphrase -- and the quick-unlock/recovery-phrase
// wrappers built on it -- never change underneath the user.
const OLDER_PASSPHRASE_MESSAGE = 'This backup was made with a different passphrase.';

async function restoreFromBackup(backupFilePath, passphrase, backupPassphrase = passphrase) {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error('Backup file not found.');
  }

  const dbPath = connection.getDbPath();

  // Checks before anything destructive happens, each failing with a
  // clean error and zero side effects: the passphrase has to be *this*
  // vault's real one, and the chosen file has to open with the backup's
  // passphrase.
  try {
    connection.verifyPassphraseAgainstFile(dbPath, passphrase);
  } catch {
    throw new Error("That isn't your current passphrase.");
  }
  try {
    connection.verifyPassphraseAgainstFile(backupFilePath, backupPassphrase);
  } catch {
    // Same passphrase for both means the renderer hasn't asked for the
    // backup's own one yet -- say so, so it can.
    throw new Error(backupPassphrase === passphrase ? OLDER_PASSPHRASE_MESSAGE : 'That passphrase doesn\'t open this backup either.');
  }

  // Re-key a scratch copy first, so the chosen backup file itself is never
  // modified and a failure here leaves the live vault untouched.
  const incomingPath = `${dbPath}.restore-${Date.now()}.tmp`;
  fs.copyFileSync(backupFilePath, incomingPath);
  try {
    if (backupPassphrase !== passphrase) {
      const incoming = new Database(incomingPath, { fileMustExist: true });
      try {
        incoming.pragma(`key='${connection.escapeForPragma(backupPassphrase)}'`);
        incoming.pragma(`rekey='${connection.escapeForPragma(passphrase)}'`);
      } finally {
        incoming.close();
      }
      connection.verifyPassphraseAgainstFile(incomingPath, passphrase);
    }
  } catch (err) {
    fs.rmSync(incomingPath, { force: true });
    throw err;
  }

  connection.close();

  const safetyCopyPath = `${dbPath}.pre-restore-${Date.now()}.bak`;
  fs.copyFileSync(dbPath, safetyCopyPath);

  fs.copyFileSync(incomingPath, dbPath);
  fs.rmSync(incomingPath, { force: true });

  // Passphrase already proven valid above, so this can't fail on that
  // account. runMigrations() brings an older backup's schema forward --
  // the same call every normal unlock already makes.
  connection.open(passphrase);
  runMigrations(connection.getDb());

  return { safetyCopyPath };
}

module.exports = { restoreFromBackup, OLDER_PASSPHRASE_MESSAGE };
