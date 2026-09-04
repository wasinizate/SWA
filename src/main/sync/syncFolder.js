'use strict';

// Reads/writes the shared sync folder -- the only network-free
// "transport" this feature uses (whatever keeps that folder's contents
// consistent across machines, e.g. Dropbox/OneDrive/Syncthing/a shared
// drive, is the user's own already-trusted setup, not something this
// app does). One file per (writer instance, shared client): each
// instance overwrites its own file in place every cycle rather than
// accumulating history.
//
// Reuses src/main/dataExchange/'s existing bundle/encrypt/decrypt
// machinery unmodified -- this module is purely about *where* those
// bundles live and *which* files belong to "other instances," not about
// the bundle format itself.

const fs = require('fs');
const path = require('path');
const personRepo = require('../db/repositories/person');
const { buildPersonExport } = require('../dataExchange/buildExportBundle');
const { encryptExport } = require('../dataExchange/encryptExport');
const { decryptExport } = require('../dataExchange/decryptExport');

const FILE_EXTENSION = '.swasync';

function fileNameFor(instanceId, personExternalId) {
  return `${instanceId}__${personExternalId}${FILE_EXTENSION}`;
}

// Writes one file per shared client, overwriting this instance's own
// previous export for that client. Every filesystem call is wrapped --
// a missing/unwritable folder (not yet created, a disconnected drive,
// etc.) skips this cycle rather than crashing the poller, same
// "forgiving, not fatal" posture icsImport.js's parser already has.
function exportSharedPersonsToFolder(folderPath, instanceId, syncPassphrase) {
  let written = 0;
  try {
    fs.mkdirSync(folderPath, { recursive: true });
  } catch (err) {
    return { written: 0, error: err.message };
  }

  for (const person of personRepo.listShared()) {
    try {
      const bundle = buildPersonExport(person.id); // orderIds: null -> every order
      const encrypted = encryptExport(bundle, syncPassphrase);
      const filePath = path.join(folderPath, fileNameFor(instanceId, bundle.person.externalId));
      fs.writeFileSync(filePath, encrypted, 'utf8');
      written += 1;
    } catch (err) {
      // One client's export failing (e.g. a mid-write filesystem hiccup)
      // shouldn't stop the others from being written this cycle.
    }
  }

  return { written };
}

// Lists every *other* instance's export files in the folder, decrypted.
// A file that fails to decrypt (wrong/rotated passphrase, or a stray
// non-SWA file someone else dropped in the same folder) is skipped, not
// fatal -- same reasoning as exportSharedPersonsToFolder() above.
function scanFolderForIncoming(folderPath, instanceId, syncPassphrase) {
  let fileNames;
  try {
    fileNames = fs.readdirSync(folderPath);
  } catch (err) {
    return { incoming: [], error: err.message };
  }

  const ownPrefix = `${instanceId}__`;
  const incoming = [];

  for (const fileName of fileNames) {
    if (!fileName.endsWith(FILE_EXTENSION)) continue;
    if (fileName.startsWith(ownPrefix)) continue; // this instance's own export

    const separatorIndex = fileName.indexOf('__');
    if (separatorIndex === -1) continue;
    const sourceInstanceId = fileName.slice(0, separatorIndex);

    try {
      const contents = fs.readFileSync(path.join(folderPath, fileName), 'utf8');
      const bundle = decryptExport(contents, syncPassphrase);
      incoming.push({ sourceInstanceId, personExternalId: bundle.person.externalId, bundle });
    } catch (err) {
      // Wrong passphrase, corrupted file, or an incompatible format
      // version -- decryptExport() already throws a clear message for
      // each case; here it just means "not something we can use."
    }
  }

  return { incoming };
}

module.exports = { exportSharedPersonsToFolder, scanFolderForIncoming, fileNameFor };
