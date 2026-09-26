'use strict';

const { ipcMain } = require('electron');
const { getDb } = require('../db/connection');
const personRepo = require('../db/repositories/person');
const personDuplicatesRepo = require('../db/repositories/personDuplicates');
const platformAccountRepo = require('../db/repositories/platformAccount');
const { parseProfileLink } = require('../platformLinks');

// Pasting a profile link into "Add client": creates the client (named after
// the handle, renamable later) with that account attached, in one step.
// If some client already has that exact account, nothing is created and
// that client is returned instead, so a pasted link never makes a
// duplicate.
function addFromProfileLink(text) {
  const parsed = parseProfileLink(text);
  if (!parsed) throw new Error("That doesn't look like a profile link.");

  const existing = platformAccountRepo.findByPlatformAndUsername(parsed.platformName, parsed.username);
  if (existing.length > 0) {
    return { existing: true, personId: existing[0].person_id, label: existing[0].person_label, ...parsed };
  }

  const person = getDb().transaction(() => {
    const created = personRepo.create({ privateLabel: parsed.username });
    platformAccountRepo.create({
      personId: created.id,
      platformName: parsed.platformName,
      username: parsed.username,
      profileUrl: parsed.profileUrl,
    });
    return created;
  })();
  return { existing: false, personId: person.id, label: person.private_label, ...parsed };
}

function registerPersonIpc() {
  ipcMain.handle('person:listAll', () => personRepo.listAll());
  ipcMain.handle('person:get', (_event, id) => personRepo.get(id));
  ipcMain.handle('person:create', (_event, data) => personRepo.create(data));
  ipcMain.handle('person:update', (_event, id, data) => personRepo.update(id, data));
  ipcMain.handle('person:delete', (_event, id) => personRepo.remove(id));
  ipcMain.handle('person:mergeInto', (_event, loserId, survivorId) => personRepo.mergeInto(loserId, survivorId));
  ipcMain.handle('person:addFromProfileLink', (_event, text) => addFromProfileLink(text));

  ipcMain.handle('person:findDuplicateCandidates', () => personDuplicatesRepo.findDuplicateCandidates());
}

module.exports = { registerPersonIpc };
