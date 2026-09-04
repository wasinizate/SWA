'use strict';

// The single enforcement point for the "Network access" master switch
// (Settings -> Privacy). Locked by default -- see
// settingsRepo.getNetworkAccessEnabled(). Every network-capable code
// path in the app calls assertNetworkAllowed() before making a
// request, not just the UI: today that's just "Check for updates"
// (src/main/ipc/updateIpc.js), and this is the one place any future
// cloud-sync feature (Dropbox/Drive API, Google Calendar OAuth) must
// also check, so the toggle is a real guarantee regardless of what
// else is configured or what a renderer-side bug might do.

const settingsRepo = require('../db/repositories/settings');

function isNetworkAllowed() {
  return settingsRepo.getNetworkAccessEnabled();
}

function assertNetworkAllowed() {
  if (!isNetworkAllowed()) {
    throw new Error('Network access is locked. Enable it in Settings -> Privacy first.');
  }
}

module.exports = { isNetworkAllowed, assertNetworkAllowed };
