'use strict';

const fs = require('fs');
const { BrowserWindow, dialog } = require('electron');
const orderRepo = require('../db/repositories/order');
const personRepo = require('../db/repositories/person');
const platformAccountRepo = require('../db/repositories/platformAccount');
const { buildOrderReceiptHtml } = require('./orderReceiptHtml');

// Renders one order to a PDF file chosen by the user via a native save
// dialog. Uses Electron's built-in webContents.printToPDF() -- no extra
// PDF library dependency. Returns the saved file path, or null if the
// user cancelled the save dialog.
//
// `parentWindow` (optional) is the app window that triggered this, purely
// so the native save dialog appears attached to/on top of it.
async function exportOrderPdf(orderId, parentWindow) {
  const order = orderRepo.get(orderId);
  if (!order) throw new Error(`Order ${orderId} not found.`);

  const person = personRepo.get(order.person_id);
  const platformAccount = order.platform_account_id ? platformAccountRepo.get(order.platform_account_id) : null;

  const html = buildOrderReceiptHtml({ order, person, platformAccount });

  // A window that's never shown to the user -- it exists only so Chromium
  // has a page to render before printToPDF() captures it.
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    const pdfBuffer = await printWindow.webContents.printToPDF({});

    const safeLabel = (person?.private_label || 'client').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const dialogOptions = {
      title: 'Export order to PDF',
      defaultPath: `order-${order.id}-${safeLabel}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    };
    const { canceled, filePath } = parentWindow
      ? await dialog.showSaveDialog(parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (canceled || !filePath) return null;

    fs.writeFileSync(filePath, pdfBuffer);
    return filePath;
  } finally {
    printWindow.destroy();
  }
}

module.exports = { exportOrderPdf };
