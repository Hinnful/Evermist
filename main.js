'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const yauzl = require('yauzl');

// Portable data: store all Chromium user data (IndexedDB, caches) next to the
// .exe so the entire folder can be copied between PCs.
// electron-builder portable sets PORTABLE_EXECUTABLE_DIR to the real .exe location
// (the app itself runs from a temp extraction directory).
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDir) {
  app.setPath('userData', path.join(portableDir, 'evermist-data'));
}

// Window/taskbar icon for `npm start` (dev). In packaged builds the OS uses the
// icon embedded in the .exe/.app by electron-builder, so a missing file here is
// harmless — fall back to undefined rather than pointing at a non-existent path.
const devIcon = path.join(__dirname, 'build', 'icon.png');
const windowIcon = fs.existsSync(devIcon) ? devIcon : undefined;

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: windowIcon,
  });
  splash.setMenu(null);
  splash.loadFile('splash.html');
  splash.once('ready-to-show', () => splash.show());
  return splash;
}

function createDMWindow() {
  const splash = createSplashWindow();
  const splashShownAt = Date.now();

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Evermist',
    icon: windowIcon,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setMenu(null);
  win.loadFile('index.html');

  // Hand off from splash to the app once the renderer has painted. Keep the splash
  // up for a brief minimum so it reads as a branded intro rather than a flash, and
  // cap it so a slow init can never leave the splash hanging.
  const MIN_SPLASH_MS = 1000;
  let handedOff = false;
  const handOff = () => {
    if (handedOff) return;
    handedOff = true;
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - splashShownAt));
    setTimeout(() => {
      win.show();
      if (!splash.isDestroyed()) splash.destroy();
    }, wait);
  };
  win.once('ready-to-show', handOff);
  setTimeout(handOff, 6000); // safety cap

  // Allow window.open() in the renderer to create the player BrowserWindow.
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1200,
      height: 800,
      title: 'Evermist — Player View',
      icon: windowIcon,
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

function isSafeId(id) { return typeof id === 'string' && /^[0-9a-zA-Z_-]+$/.test(id); }

// --- Video file storage IPC ---

ipcMain.handle('save-video-file', async (event, sourcePath, sceneId, mimeType) => {
  if (!isSafeId(sceneId)) throw new Error(`Invalid sceneId: ${sceneId}`);
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
  if (!isSafeId(sceneId)) throw new Error(`Invalid sceneId: ${sceneId}`);
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
  if (!isSafeId(sceneId)) return null;
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
  if (!isSafeId(sceneId)) return;
  for (const ext of ['.webm', '.mp4']) {
    try { await fs.promises.unlink(path.join(mapsDir, sceneId + ext)); } catch {}
  }
});

// --- Backup / Restore IPC ---

ipcMain.handle('show-save-dialog', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, opts || {});
  return canceled ? null : filePath;
});

ipcMain.handle('show-open-dialog', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, opts || {});
  return canceled ? null : filePaths;
});

// scenesData: [{id, mapType, mapExt, metadata, mapBuffer (ArrayBuffer|null), fogBuffer, thumbBuffer}]
// Video maps are read from mapsDir by id; image/fog/thumb come as ArrayBuffers.
ipcMain.handle('create-backup-zip', async (event, destPath, scenesData) => {
  // Pre-check which video files actually exist on disk
  for (const s of scenesData) {
    if (s.mapType === 'video') {
      try { await fs.promises.access(path.join(mapsDir, s.id + s.mapExt)); s._videoExists = true; }
      catch { s._videoExists = false; }
    }
  }

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);

    archive.append(JSON.stringify(scenesData.map(s => s.metadata), null, 2), { name: 'manifest.json' });

    scenesData.forEach((s, idx) => {
      const base = `scenes/${s.id}`;
      if (s.mapType === 'video') {
        if (s._videoExists) archive.file(path.join(mapsDir, s.id + s.mapExt), { name: `${base}/map${s.mapExt}` });
      } else if (s.mapBuffer) {
        archive.append(Buffer.from(s.mapBuffer), { name: `${base}/map${s.mapExt}` });
      }
      if (s.fogBuffer)   archive.append(Buffer.from(s.fogBuffer),   { name: `${base}/fog.png` });
      if (s.thumbBuffer) archive.append(Buffer.from(s.thumbBuffer), { name: `${base}/thumb.jpg` });
      event.sender.send('backup-progress', { done: idx + 1, total: scenesData.length, phase: 'export' });
    });

    archive.finalize();
  });
});

// Returns parsed manifest.json array from the zip.
ipcMain.handle('read-backup-manifest', async (_event, zipPath) => {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on('entry', entry => {
        if (entry.fileName === 'manifest.json') {
          zipfile.openReadStream(entry, (err2, rs) => {
            if (err2) { zipfile.close(); return reject(err2); }
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => {
              try { zipfile.close(); resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
              catch (e) { reject(e); }
            });
            rs.on('error', e => { zipfile.close(); reject(e); });
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => { zipfile.close(); reject(new Error('manifest.json not found in zip')); });
      zipfile.on('error', reject);
    });
  });
});

// assignments: [{newId, originalId, mapType, mapExt}]
// Video maps are written to mapsDir/{newId}.ext; all others returned as ArrayBuffers.
ipcMain.handle('extract-backup-scenes', async (event, zipPath, assignments) => {
  for (const a of assignments) {
    if (!isSafeId(a.newId))      throw new Error(`Invalid newId: ${a.newId}`);
    if (!isSafeId(a.originalId)) throw new Error(`Invalid originalId: ${a.originalId}`);
  }

  // Map zip entry path → assignment role
  const pathMap = {};
  assignments.forEach(a => {
    const base = `scenes/${a.originalId}`;
    pathMap[`${base}/map${a.mapExt}`] = { newId: a.newId, type: 'map', a };
    pathMap[`${base}/fog.png`]        = { newId: a.newId, type: 'fog', a };
    pathMap[`${base}/thumb.jpg`]      = { newId: a.newId, type: 'thumb', a };
  });

  const results = {};
  const pending = {};
  assignments.forEach(a => {
    results[a.newId] = { newId: a.newId, mapBuffer: null, fogBuffer: null, thumbBuffer: null };
    pending[a.newId] = ['map', 'fog', 'thumb'];
  });
  let doneScenes = 0;

  const markDone = (newId, type) => {
    const p = pending[newId];
    const i = p.indexOf(type);
    if (i !== -1) p.splice(i, 1);
    if (p.length === 0) {
      doneScenes++;
      event.sender.send('backup-progress', { done: doneScenes, total: assignments.length, phase: 'restore' });
    }
  };

  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();

      zipfile.on('entry', entry => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        const info = pathMap[entry.fileName];
        if (!info) { zipfile.readEntry(); return; }

        const { newId, type, a } = info;
        zipfile.openReadStream(entry, (err2, rs) => {
          if (err2) { zipfile.close(); return reject(err2); }

          if (type === 'map' && a.mapType === 'video') {
            const dest = path.join(mapsDir, newId + a.mapExt);
            const ws = fs.createWriteStream(dest);
            rs.pipe(ws);
            ws.on('finish', () => { markDone(newId, type); zipfile.readEntry(); });
            ws.on('error', e => { zipfile.close(); reject(e); });
          } else {
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => {
              const buf = Buffer.concat(chunks);
              const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
              if (type === 'map')        results[newId].mapBuffer   = ab;
              else if (type === 'fog')   results[newId].fogBuffer   = ab;
              else if (type === 'thumb') results[newId].thumbBuffer = ab;
              markDone(newId, type);
              zipfile.readEntry();
            });
            rs.on('error', e => { zipfile.close(); reject(e); });
          }
        });
      });

      zipfile.on('end', () => { zipfile.close(); resolve(); });
      zipfile.on('error', reject);
    });
  });

  return Object.values(results);
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
