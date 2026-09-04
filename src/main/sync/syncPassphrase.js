'use strict';

// Stores/retrieves the shared-folder sync passphrase (see
// src/main/sync/syncFolder.js), wrapped via Electron's safeStorage --
// same OS-keychain mechanism src/main/security/passphrase.js already
// uses for the opt-in "quick unlock" feature, and the same documented
// trade-off: anyone who can act as the current OS user could have this
// app decrypt shared-folder exports too, without knowing the passphrase.
//
// Unlike quick-unlock's blob (which has to live in the plaintext-
// adjacent vault-meta file, since it's needed to unlock the database in
// the first place), this blob lives inside app_settings -- *inside* the
// encrypted database. Sync has no bootstrapping problem: the vault is
// already unlocked whenever sync runs (see syncScheduler.js's guard), so
// this is strictly better-protected than quick-unlock's blob has to be.

const { safeStorage } = require('electron');
const settingsRepo = require('../db/repositories/settings');

function setSyncPassphrase(passphrase) {
  if (!passphrase) throw new Error('Sync passphrase is required.');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secure storage is not available on this system.');
  }

  const encrypted = safeStorage.encryptString(String(passphrase));
  settingsRepo.setSyncPassphraseBlob(encrypted.toString('base64'));
}

function getSyncPassphrase() {
  const blob = settingsRepo.getSyncPassphraseBlob();
  if (!blob) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;

  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch (err) {
    return null; // OS keychain unavailable/changed since the blob was written
  }
}

function hasSyncPassphrase() {
  return Boolean(settingsRepo.getSyncPassphraseBlob());
}

function clearSyncPassphrase() {
  settingsRepo.setSyncPassphraseBlob('');
}

module.exports = { setSyncPassphrase, getSyncPassphrase, hasSyncPassphrase, clearSyncPassphrase };
