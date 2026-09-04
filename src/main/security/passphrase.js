'use strict';

// This module owns the vault's lifecycle: creating it, unlocking/locking
// it, and the opt-in "quick unlock" convenience feature. It's the single
// place that ever handles a raw passphrase string in the main process.

const { safeStorage } = require('electron');
const connection = require('../db/connection');
const { runMigrations } = require('../db/migrate');
const vaultMeta = require('./vaultMeta');
const recoveryPhrase = require('./recoveryPhrase');

const MIN_PASSPHRASE_LENGTH = 8;

// Set only by recoverWithPhrase(), cleared by changePassphrase() -- never
// persisted to vault.json. Deliberately in-memory only: if the app is
// closed before the forced reset completes, nothing has been invalidated
// yet (that only happens inside changePassphrase()), so the same
// recovery phrase still works on the next launch. No lockout risk from
// bailing out mid-flow.
let mustResetPassphrase = false;

// Creates a brand-new encrypted database protected by `passphrase`. Only
// valid when no vault exists yet.
function setup(passphrase) {
  const meta = vaultMeta.readMeta();
  if (meta.initialized) {
    throw new Error('A vault already exists. Use unlock() instead.');
  }
  assertPassphraseStrength(passphrase);

  const db = connection.open(passphrase);
  runMigrations(db);

  vaultMeta.writeMeta({ ...meta, initialized: true });
}

// Opens an existing encrypted database. Throws if the passphrase is wrong.
function unlock(passphrase) {
  const meta = vaultMeta.readMeta();
  if (!meta.initialized) {
    throw new Error('No vault exists yet. Use setup() first.');
  }
  connection.open(passphrase);
  // Installs upgraded from an older version of the app may be missing
  // later migrations -- safe to re-run, runMigrations() only applies
  // migrations that haven't been applied yet.
  runMigrations(connection.getDb());
}

function lock() {
  connection.close();
}

function isUnlocked() {
  return connection.isOpen();
}

function status() {
  const meta = vaultMeta.readMeta();
  return {
    initialized: meta.initialized,
    quickUnlockEnabled: meta.quickUnlockEnabled,
    unlocked: isUnlocked(),
    quickUnlockAvailable: meta.quickUnlockEnabled && safeStorage.isEncryptionAvailable(),
    recoveryEnabled: meta.recoveryEnabled,
    mustResetPassphrase,
  };
}

// Re-keys the already-unlocked database to a new passphrase, then
// re-wraps the quick-unlock blob (if enabled) so it stays in sync. The
// recovery-phrase blob can't be silently re-wrapped the same way -- doing
// so would need the original 6 words again, which are never stored
// anywhere -- so a recovery phrase is instead cleared here and the caller
// is told to make a new one.
function changePassphrase(newPassphrase) {
  if (!isUnlocked()) throw new Error('Vault must be unlocked to change its passphrase.');
  assertPassphraseStrength(newPassphrase);

  const db = connection.getDb();
  db.pragma(`rekey='${connection.escapeForPragma(newPassphrase)}'`);

  const meta = vaultMeta.readMeta();
  if (meta.quickUnlockEnabled) {
    setQuickUnlock(true, newPassphrase);
  }

  const recoveryCleared = meta.recoveryEnabled;
  if (recoveryCleared) {
    clearRecoveryPhrase();
  }
  mustResetPassphrase = false;

  return { recoveryCleared };
}

// Generates a brand-new 6-word recovery phrase, wraps `currentPassphrase`
// with it, and stores the wrapped blob. `currentPassphrase` is verified
// against the live database file first (rather than trusted blindly) so
// a stale or mistaken caller can't silently attach recovery to the wrong
// secret. Returns the plaintext words -- the only place they're ever
// handed out; nothing here or in vaultMeta.js ever stores them.
function generateRecoveryPhrase(currentPassphrase) {
  if (!isUnlocked()) throw new Error('Vault must be unlocked to set up a recovery phrase.');
  connection.verifyPassphraseAgainstFile(connection.getDbPath(), currentPassphrase);

  const words = recoveryPhrase.generatePhrase();
  const { salt, blob } = recoveryPhrase.wrapPassphrase(words, currentPassphrase);

  const meta = vaultMeta.readMeta();
  vaultMeta.writeMeta({ ...meta, recoveryEnabled: true, recoverySalt: salt, recoveryBlob: blob });

  return words;
}

function clearRecoveryPhrase() {
  const meta = vaultMeta.readMeta();
  vaultMeta.writeMeta({ ...meta, recoveryEnabled: false, recoverySalt: null, recoveryBlob: null });
}

// Unlocks using the 6-word recovery phrase instead of the passphrase.
// Success sets mustResetPassphrase so the renderer forces a passphrase
// change before letting the user into the rest of the app -- see the
// module-level comment on that flag for why it's safe to keep in memory
// only.
function recoverWithPhrase(words) {
  const meta = vaultMeta.readMeta();
  if (!meta.recoveryEnabled) {
    throw new Error('No recovery phrase has been set up for this vault.');
  }

  const recoveredPassphrase = recoveryPhrase.unwrapPassphrase(words, meta.recoverySalt, meta.recoveryBlob);
  unlock(recoveredPassphrase);
  mustResetPassphrase = true;
}

// Turns the opt-in convenience unlock on/off. When enabling, the
// passphrase is encrypted with the OS keychain (via Electron's
// safeStorage) and only the ciphertext is stored in vault.json.
//
// Trade-off (documented in full in README.md's threat model): this makes
// unlocking more convenient, but it means anyone who can act as the
// current OS user could have this app decrypt the vault too, without
// knowing the passphrase. It's off by default for that reason.
function setQuickUnlock(enabled, passphrase) {
  const meta = vaultMeta.readMeta();

  if (!enabled) {
    vaultMeta.writeMeta({ ...meta, quickUnlockEnabled: false, quickUnlockBlob: null });
    return;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secure storage is not available on this system.');
  }

  const encrypted = safeStorage.encryptString(String(passphrase));
  vaultMeta.writeMeta({
    ...meta,
    quickUnlockEnabled: true,
    quickUnlockBlob: encrypted.toString('base64'),
  });
}

// Attempts to unlock using the stored quick-unlock blob. Returns false
// (rather than throwing) when quick unlock isn't set up/available, so
// callers can fall back to the normal passphrase prompt.
function tryQuickUnlock() {
  const meta = vaultMeta.readMeta();
  if (!meta.quickUnlockEnabled || !meta.quickUnlockBlob) return false;
  if (!safeStorage.isEncryptionAvailable()) return false;

  const passphrase = safeStorage.decryptString(Buffer.from(meta.quickUnlockBlob, 'base64'));
  unlock(passphrase);
  return true;
}

function assertPassphraseStrength(passphrase) {
  if (!passphrase || String(passphrase).length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
}

module.exports = {
  setup,
  unlock,
  lock,
  isUnlocked,
  status,
  changePassphrase,
  setQuickUnlock,
  tryQuickUnlock,
  generateRecoveryPhrase,
  clearRecoveryPhrase,
  recoverWithPhrase,
};
