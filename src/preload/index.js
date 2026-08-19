'use strict';

// Preload script: runs in a privileged context with access to Node/Electron
// APIs, but the renderer itself never gets that access directly (see
// contextIsolation/sandbox in main/window.js). contextBridge is the only
// approved way to pass functionality across that boundary.
//
// Keep this surface narrow and specific. In particular, never expose
// ipcRenderer itself -- that would let any renderer code send arbitrary
// IPC channel names, defeating the point of listing them explicitly here.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  vault: {
    status: () => ipcRenderer.invoke('vault:status'),
    setup: (passphrase) => ipcRenderer.invoke('vault:setup', passphrase),
    unlock: (passphrase) => ipcRenderer.invoke('vault:unlock', passphrase),
    quickUnlock: () => ipcRenderer.invoke('vault:quickUnlock'),
    lock: () => ipcRenderer.invoke('vault:lock'),
    changePassphrase: (newPassphrase) => ipcRenderer.invoke('vault:changePassphrase', newPassphrase),
    setQuickUnlock: (enabled, currentPassphrase) =>
      ipcRenderer.invoke('vault:setQuickUnlock', { enabled, currentPassphrase }),
    getIdleTimeoutSeconds: () => ipcRenderer.invoke('vault:getIdleTimeoutSeconds'),
    setIdleTimeoutSeconds: (seconds) => ipcRenderer.invoke('vault:setIdleTimeoutSeconds', seconds),
    // Fires whenever the main process locks the vault (idle timeout or
    // manual lock), so the UI can react even if the user isn't mid-action.
    // Returns an unsubscribe function.
    onLocked: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('vault:locked', listener);
      return () => ipcRenderer.removeListener('vault:locked', listener);
    },
  },
  person: {
    listAll: () => ipcRenderer.invoke('person:listAll'),
    get: (id) => ipcRenderer.invoke('person:get', id),
    create: (data) => ipcRenderer.invoke('person:create', data),
    update: (id, data) => ipcRenderer.invoke('person:update', id, data),
    delete: (id) => ipcRenderer.invoke('person:delete', id),
  },
  platformAccount: {
    listByPerson: (personId) => ipcRenderer.invoke('platformAccount:listByPerson', personId),
    create: (data) => ipcRenderer.invoke('platformAccount:create', data),
    update: (id, data) => ipcRenderer.invoke('platformAccount:update', id, data),
    delete: (id) => ipcRenderer.invoke('platformAccount:delete', id),
  },
  order: {
    listByPerson: (personId) => ipcRenderer.invoke('order:listByPerson', personId),
    listAll: () => ipcRenderer.invoke('order:listAll'),
    get: (id) => ipcRenderer.invoke('order:get', id),
    create: (data) => ipcRenderer.invoke('order:create', data),
    update: (id, data) => ipcRenderer.invoke('order:update', id, data),
    delete: (id) => ipcRenderer.invoke('order:delete', id),
    getTotalsByPerson: (personId) => ipcRenderer.invoke('order:getTotalsByPerson', personId),
    listWithDeliveryDueDates: () => ipcRenderer.invoke('order:listWithDeliveryDueDates'),
    getDueDateSummary: () => ipcRenderer.invoke('order:getDueDateSummary'),
    exportPdf: (id) => ipcRenderer.invoke('order:exportPdf', id),
    getSlatedIncomeTotals: () => ipcRenderer.invoke('order:getSlatedIncomeTotals'),
    getTotalsAll: () => ipcRenderer.invoke('order:getTotalsAll'),
  },
  orderAttachment: {
    listByOrder: (orderId) => ipcRenderer.invoke('orderAttachment:listByOrder', orderId),
    add: (data) => ipcRenderer.invoke('orderAttachment:add', data),
    get: (id) => ipcRenderer.invoke('orderAttachment:get', id),
    delete: (id) => ipcRenderer.invoke('orderAttachment:delete', id),
    saveToDisk: (id) => ipcRenderer.invoke('orderAttachment:saveToDisk', id),
  },
  calendarEvent: {
    listAll: () => ipcRenderer.invoke('calendarEvent:listAll'),
    get: (id) => ipcRenderer.invoke('calendarEvent:get', id),
    create: (data) => ipcRenderer.invoke('calendarEvent:create', data),
    update: (id, data) => ipcRenderer.invoke('calendarEvent:update', id, data),
    delete: (id) => ipcRenderer.invoke('calendarEvent:delete', id),
    exportIcs: (id) => ipcRenderer.invoke('calendarEvent:exportIcs', id),
    exportAllIcs: () => ipcRenderer.invoke('calendarEvent:exportAllIcs'),
  },
  search: {
    query: (queryText) => ipcRenderer.invoke('search:query', queryText),
  },
  expense: {
    listAll: () => ipcRenderer.invoke('expense:listAll'),
    get: (id) => ipcRenderer.invoke('expense:get', id),
    create: (data) => ipcRenderer.invoke('expense:create', data),
    update: (id, data) => ipcRenderer.invoke('expense:update', id, data),
    delete: (id) => ipcRenderer.invoke('expense:delete', id),
    getTotals: () => ipcRenderer.invoke('expense:getTotals'),
  },
  incomeStatement: {
    listAll: () => ipcRenderer.invoke('incomeStatement:listAll'),
    get: (id) => ipcRenderer.invoke('incomeStatement:get', id),
    create: (data) => ipcRenderer.invoke('incomeStatement:create', data),
    update: (id, data) => ipcRenderer.invoke('incomeStatement:update', id, data),
    delete: (id) => ipcRenderer.invoke('incomeStatement:delete', id),
    getTotals: () => ipcRenderer.invoke('incomeStatement:getTotals'),
  },
  incomeStatementAttachment: {
    listByStatement: (incomeStatementId) => ipcRenderer.invoke('incomeStatementAttachment:listByStatement', incomeStatementId),
    add: (data) => ipcRenderer.invoke('incomeStatementAttachment:add', data),
    get: (id) => ipcRenderer.invoke('incomeStatementAttachment:get', id),
    delete: (id) => ipcRenderer.invoke('incomeStatementAttachment:delete', id),
    saveToDisk: (id) => ipcRenderer.invoke('incomeStatementAttachment:saveToDisk', id),
  },
  dataExchange: {
    exportPerson: (personId, passphrase) => ipcRenderer.invoke('dataExchange:exportPerson', { personId, passphrase }),
    exportOrder: (orderId, personId, passphrase) =>
      ipcRenderer.invoke('dataExchange:exportOrder', { orderId, personId, passphrase }),
    previewImport: (fileContents, passphrase) => ipcRenderer.invoke('dataExchange:previewImport', { fileContents, passphrase }),
    applyImport: (fileContents, passphrase, resolution) =>
      ipcRenderer.invoke('dataExchange:applyImport', { fileContents, passphrase, resolution }),
  },
  settings: {
    getOrderDueReminderConfig: () => ipcRenderer.invoke('settings:getOrderDueReminderConfig'),
    setOrderDueReminderConfig: (enabled, daysBefore, showSummaryOnOpen) =>
      ipcRenderer.invoke('settings:setOrderDueReminderConfig', { enabled, daysBefore, showSummaryOnOpen }),
    getTheme: () => ipcRenderer.invoke('settings:getTheme'),
    setTheme: (theme) => ipcRenderer.invoke('settings:setTheme', theme),
  },
  update: {
    // Manual, opt-in only -- see updates/checkForUpdates.js. Nothing
    // calls these except a direct click on Settings' "Check for
    // updates" button.
    check: () => ipcRenderer.invoke('update:check'),
    openReleasePage: (url) => ipcRenderer.invoke('update:openReleasePage', url),
  },
});
