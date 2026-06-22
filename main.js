'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Portable data: store all Chromium user data (IndexedDB, caches) next to the
// .exe so the entire folder can be copied between PCs.
// electron-builder portable sets PORTABLE_EXECUTABLE_DIR to the real .exe location
// (the app itself runs from a temp extraction directory).
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDir) {
  app.setPath('userData', path.join(portableDir, 'evermist-data'));
}

function createDMWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Evermist',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setMenu(null);
  win.loadFile('index.html');

  // Allow window.open() in the renderer to create the player BrowserWindow.
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1200,
      height: 800,
      title: 'Evermist — Player View',
      menuBarVisible: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    },
  }));

  // Remove the native menu bar from the player window; menuBarVisible: false
  // alone doesn't fully strip it on all platforms.
  win.webContents.on('did-create-window', (childWin) => {
    childWin.setMenu(null);
  });
}

// Native fullscreen toggle — no user-gesture requirement, bypasses Chromium's
// activation check that blocks renderer requestFullscreen() on non-focused windows.
ipcMain.on('set-fullscreen', (event, flag) => {
  BrowserWindow.fromWebContents(event.sender)?.setFullScreen(flag);
});
ipcMain.on('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

let mapsDir;

// --- Video file storage IPC ---

ipcMain.handle('save-video-file', async (event, sourcePath, sceneId, mimeType) => {
  const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
  const destPath = path.join(mapsDir, sceneId + ext);
  const stat = await fs.promises.stat(sourcePath);
  const total = stat.size;
  return new Promise((resolve, reject) => {
    let written = 0;
    const rs = fs.createReadStream(sourcePath);
    const ws = fs.createWriteStream(destPath);
    rs.on('data', (chunk) => {
      written += chunk.length;
      event.sender.send('video-save-progress', { sceneId, written, total });
    });
    rs.on('error', (err) => { ws.destroy(); reject(err); });
    ws.on('error', (err) => { rs.destroy(); reject(err); });
    ws.on('finish', () => resolve(destPath));
    rs.pipe(ws);
  });
});

ipcMain.handle('save-video-blob', async (event, sceneId, arrayBuffer, mimeType) => {
  const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
  const destPath = path.join(mapsDir, sceneId + ext);
  const buffer = Buffer.from(arrayBuffer);
  const total = buffer.length;
  const CHUNK = 4 * 1024 * 1024;
  const fd = await fs.promises.open(destPath, 'w');
  try {
    let written = 0;
    while (written < total) {
      const end = Math.min(written + CHUNK, total);
      await fd.write(buffer, written, end - written);
      written = end;
      event.sender.send('video-save-progress', { sceneId, written, total });
    }
  } finally {
    await fd.close();
  }
  return destPath;
});

ipcMain.handle('get-video-file-path', async (_event, sceneId) => {
  for (const ext of ['.webm', '.mp4']) {
    const filePath = path.join(mapsDir, sceneId + ext);
    try {
      await fs.promises.access(filePath);
      return filePath;
    } catch {}
  }
  return null;
});

ipcMain.handle('delete-video-file', async (_event, sceneId) => {
  for (const ext of ['.webm', '.mp4']) {
    try { await fs.promises.unlink(path.join(mapsDir, sceneId + ext)); } catch {}
  }
});

app.whenReady().then(() => {
  mapsDir = path.join(app.getPath('userData'), 'maps');
  fs.mkdirSync(mapsDir, { recursive: true });
  createDMWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createDMWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
