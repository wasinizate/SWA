'use strict';

// macOS-only application menu. Without this, Electron's default (no menu
// at all) means Cmd+C/Cmd+V/Cmd+X/Cmd+A silently don't work in text
// fields -- macOS routes those through the app's Edit menu, unlike
// Windows/Linux where Chromium handles them natively regardless of any
// app menu. Every item here is a built-in Electron `role`, which
// auto-fills the right label/behavior/enabled-state for the current
// platform -- nothing custom to maintain, and it's a no-op everywhere
// else (see installMacMenu()'s early return), so Windows/Linux keep
// their current menu-less look untouched.

const { Menu } = require('electron');

function installMacMenu() {
  if (process.platform !== 'darwin') return;

  const template = [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installMacMenu };
