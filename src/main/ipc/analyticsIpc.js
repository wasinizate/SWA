'use strict';

const { ipcMain } = require('electron');
const analyticsRepo = require('../db/repositories/analytics');

function registerAnalyticsIpc() {
  ipcMain.handle('analytics:getOverview', () => analyticsRepo.getOverview());
  ipcMain.handle('analytics:getTopSpenders', (_event, limit) => analyticsRepo.getTopSpenders(limit));
  ipcMain.handle('analytics:getRevenueByPriority', () => analyticsRepo.getRevenueByPriority());
  ipcMain.handle('analytics:getRevenueByPlatform', () => analyticsRepo.getRevenueByPlatform());
  ipcMain.handle('analytics:getMonthlyRevenueTrend', (_event, months) => analyticsRepo.getMonthlyRevenueTrend(months));
}

module.exports = { registerAnalyticsIpc };
