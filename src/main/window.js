'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      // These three settings keep the renderer's web content (which loads
      // local HTML/JS, but the same rule applies if that ever changes) from
      // getting direct access to Node.js or Electron internals. All
      // privileged work happens in the main process; the renderer only
      // gets the narrow API that preload/index.js explicitly exposes.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false, // avoids Chromium fetching spellcheck dictionaries
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Forwards renderer-side console warnings/errors (including CSP
  // violations, which show up as console errors, not thrown exceptions)
  // into the main process's own stdout -- handy for diagnosing renderer
  // bugs without needing to manually open DevTools. Routine console.log
  // ('info'/'debug') is left out to avoid noise.
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') {
      console.log(`[renderer ${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });

  // Uncomment while developing to open the DevTools automatically:
  // win.webContents.openDevTools();

  return win;
}

module.exports = { createMainWindow };
