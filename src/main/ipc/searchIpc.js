'use strict';

const { ipcMain } = require('electron');
const searchRepo = require('../db/repositories/search');

function registerSearchIpc() {
  ipcMain.handle('search:query', (_event, queryText) => searchRepo.search(queryText));
}

module.exports = { registerSearchIpc };
