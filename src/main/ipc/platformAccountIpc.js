'use strict';

const { ipcMain, shell } = require('electron');
const platformAccountRepo = require('../db/repositories/platformAccount');
const { profileUrlFor, isKnownPlatform } = require('../platformLinks');

// has_profile_link tells the renderer which badges to make clickable,
// without the renderer ever handling the URL itself.
function withProfileLinkFlag(account) {
  return { ...account, has_profile_link: profileUrlFor(account) !== null };
}

function registerPlatformAccountIpc() {
  ipcMain.handle('platformAccount:listByPerson', (_event, personId) =>
    platformAccountRepo.listByPerson(personId).map(withProfileLinkFlag)
  );
  ipcMain.handle('platformAccount:create', (_event, data) => platformAccountRepo.create(data));
  ipcMain.handle('platformAccount:update', (_event, id, data) => platformAccountRepo.update(id, data));
  ipcMain.handle('platformAccount:delete', (_event, id) => platformAccountRepo.remove(id));
  ipcMain.handle('platformAccount:findByPlatformAndUsername', (_event, platformName, username, options) =>
    platformAccountRepo.findByPlatformAndUsername(platformName, username, options)
  );
  ipcMain.handle('platformAccount:isKnownPlatform', (_event, platformName) => isKnownPlatform(platformName));

  // Takes an account id, not a URL: the link is always rebuilt here from
  // the stored account (see platformLinks.js), so nothing the renderer
  // sends can make this open anything but an https:// profile page.
  ipcMain.handle('platformAccount:openProfile', async (_event, accountId) => {
    const account = platformAccountRepo.get(accountId);
    const url = account ? profileUrlFor(account) : null;
    if (!url) throw new Error('No profile link for this account.');
    await shell.openExternal(url);
    return url;
  });
}

module.exports = { registerPlatformAccountIpc };
