'use strict';

const { ipcMain, app, shell } = require('electron');
const { checkForUpdates, REPO } = require('../updates/checkForUpdates');
const networkGuard = require('../security/networkGuard');

function registerUpdateIpc() {
  ipcMain.handle('update:check', async () => {
    try {
      networkGuard.assertNetworkAllowed();
      return await checkForUpdates(app.getVersion());
    } catch (err) {
      return { error: err.message };
    }
  });

  // Only ever opens this project's own GitHub pages -- never an
  // arbitrary URL handed in from the renderer, even though today's only
  // caller passes back exactly the URL this same process just fetched.
  // Validating here (not trusting the renderer) is the actual security
  // boundary.
  ipcMain.handle('update:openReleasePage', (_event, url) => {
    const allowedPrefix = `https://github.com/${REPO}`;
    if (typeof url !== 'string' || !url.startsWith(allowedPrefix)) {
      throw new Error("Refused to open a URL outside this project's GitHub pages.");
    }
    shell.openExternal(url);
  });
}

module.exports = { registerUpdateIpc };
