'use strict';

const { ipcMain } = require('electron');
const { extractStatementFromPdf } = require('../incomeImport/pdfStatementParser');
const { parseCsvText } = require('../incomeImport/csvStatementParser');

function registerIncomeImportIpc() {
  // `data` is a Uint8Array crossing the IPC boundary (structured clone
  // handles typed arrays natively) -- Buffer.from() here is a view, not
  // a copy, same as every other binary-attachment handler in this app.
  ipcMain.handle('incomeImport:parsePdf', async (_event, data) => {
    return extractStatementFromPdf(Buffer.from(data));
  });

  ipcMain.handle('incomeImport:parseCsv', (_event, text) => parseCsvText(text));
}

module.exports = { registerIncomeImportIpc };
