'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// vault.json lives next to the encrypted database in the OS app-data
// folder. It ONLY ever holds non-secret bookkeeping: whether a vault has
// been set up yet, and (optionally) an OS-keychain-wrapped passphrase blob
// for the opt-in "quick unlock" feature. The passphrase itself is NEVER
// written here in plaintext -- see passphrase.js for how the blob is
// produced (Electron's safeStorage, tied to the OS user account).

function getMetaPath() {
  return path.join(app.getPath('userData'), 'vault.json');
}

const DEFAULT_META = {
  initialized: false,
  quickUnlockEnabled: false,
  quickUnlockBlob: null, // base64 string from Electron's safeStorage, or null
};

function readMeta() {
  const metaPath = getMetaPath();
  if (!fs.existsSync(metaPath)) return { ...DEFAULT_META };

  try {
    const raw = fs.readFileSync(metaPath, 'utf8');
    return { ...DEFAULT_META, ...JSON.parse(raw) };
  } catch (err) {
    // Corrupt/unreadable file -- fail safe as "not initialized" rather
    // than crash the app.
    console.error('Failed to read vault.json, treating as a fresh install:', err);
    return { ...DEFAULT_META };
  }
}

function writeMeta(meta) {
  fs.writeFileSync(getMetaPath(), JSON.stringify(meta, null, 2), 'utf8');
}

module.exports = { readMeta, writeMeta, getMetaPath };
