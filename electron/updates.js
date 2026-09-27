'use strict';
// updates.js — what the app knows about a newer release: the check, the download, and the state
// the About line and the toast read.

const { ipcMain, shell, app } = require('electron');
const { initMacUpdate } = require('./macUpdate.js');

let getDmWin, sendTo;

function register(ctx) {
  ({ getDmWin, sendTo } = ctx);
}

// --- Auto-update ---
//
// NSIS and AppImage replace themselves through electron-updater. macOS takes its own path in
// macUpdate.js. A dev run is skipped so `npm start` never reaches GitHub.
//
// ⚠ KEEP THE LAST STATUS. The DM window can still be loading when the check answers, and the
// event alone would lose that answer to a race.
let _updateStatus = { state: 'none' };

function setUpdateStatus(status) {
  _updateStatus = status;
  sendTo(getDmWin(), 'update-status', status);
}

function initAutoUpdate() {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') { initMacUpdate(setUpdateStatus); return; }
  const { autoUpdater } = require('electron-updater');
  // ⚠ NOTHING INSTALLS WITHOUT THE BUTTON, quitting included - see PRODUCT.md.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  // ⚠ DOWNGRADES ALLOWED, and that IS the rollback: deleting a bad release makes the previous one
  // newest, and electron-updater refuses to go backwards without this.
  autoUpdater.allowDowngrade = true;

  autoUpdater.on('update-available',     i => setUpdateStatus({ state: 'downloading', version: i.version }));
  autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'none' }));
  autoUpdater.on('download-progress',    p => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded',    i => setUpdateStatus({ state: 'ready', version: i.version }));

  autoUpdater.on('error', err => setUpdateStatus({ state: 'error', message: String((err && err.message) || err) }));

  ipcMain.on('install-update', () => autoUpdater.quitAndInstall());
  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('update-state', () => _updateStatus);

// The URL is fixed here: a renderer that could name its own opens anything.
ipcMain.on('open-releases-page', () => {
  shell.openExternal('https://github.com/Hinnful/Evermist/releases').catch(() => {});
});

// ⚠ The TAG is all the renderer names, and only in a tag's shape; anything else is dropped.
ipcMain.on('open-release-page', (_e, tag) => {
  if (!/^v\d+\.\d+\.\d+$/.test(String(tag || ''))) return;
  shell.openExternal('https://github.com/Hinnful/Evermist/releases/tag/' + tag).catch(() => {});
});

module.exports = { register, initAutoUpdate };
