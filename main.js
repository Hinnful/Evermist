'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const yauzl = require('yauzl');

// Stress-test mode: activated by `npm run stress` (passes --stress). Inert under
// plain `npm start` and in the shipped .exe (which never passes the flag).
const stressMode = process.argv.includes('--stress');
const stressNoReveals = process.argv.includes('--stress-no-reveals');
const stressIntervalArg = process.argv.find(a => a.startsWith('--stress-interval='));
const stressMs = stressIntervalArg
  ? (v => (isNaN(v) || v <= 0 ? 900000 : v))(parseInt(stressIntervalArg.split('=')[1], 10))
  : 900000;
if (stressMode) {
  const id = powerSaveBlocker.start('prevent-display-sleep');
  console.log('[stress] powerSaveBlocker started id=' + id + ' interval=' + stressMs + 'ms');
}

// Portable data: store all Chromium user data (IndexedDB, caches) next to the
// .exe so the entire folder can be copied between PCs.
// electron-builder portable sets PORTABLE_EXECUTABLE_DIR to the real .exe location
// (the app itself runs from a temp extraction directory).
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDir) {
  app.setPath('userData', path.join(portableDir, 'evermist-data'));
}

// Prevent Chromium from removing the video track on muted looping videos that its
// compositor deems "occluded" (covered by canvas layers). Without this flag,
// readyState drops to 1-2 after ~30 s, causing cyclic 1-3 s video freezes.
app.commandLine.appendSwitch('disable-features', 'BackgroundVideoTrackOptimization');

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
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setMenu(null);
  if (stressMode) {
    const q = { stress: '1' };
    if (stressMs !== 900000) q.stressMs = String(stressMs);
    if (stressNoReveals) q.noReveals = '1';
    win.loadFile('index.html', { query: q });
  } else {
    win.loadFile('index.html');
  }
  dmWin = win;
  win.once('closed', () => { if (dmWin === win) dmWin = null; });
  // visibilitychange does not fire on Windows OS-minimize, so signal the renderer
  // here instead — lets it pause the PixiJS ticker / flush the texture pool while hidden.
  win.on('minimize', () => win.webContents.send('window-visibility', { visible: false }));
  win.on('restore',  () => win.webContents.send('window-visibility', { visible: true  }));
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
        backgroundThrottling: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    },
  }));

  // Remove the native menu bar from the player window; menuBarVisible: false
  // alone doesn't fully strip it on all platforms. Also track it for display pushes.
  win.webContents.on('did-create-window', (childWin) => {
    childWin.setMenu(null);
    playerWin = childWin;
    childWin.once('closed', () => {
      if (playerWin === childWin) playerWin = null;
      clearTimeout(_playerMovedTimer);
    });
    childWin.on('minimize', () => childWin.webContents.send('window-visibility', { visible: false }));
    childWin.on('restore',  () => childWin.webContents.send('window-visibility', { visible: true  }));
    // Push once the renderer is ready to receive IPC messages.
    childWin.webContents.once('did-finish-load', () => pushPlayerDisplay());
    // Re-push when the Player window is moved (debounced — fires after drag settles).
    childWin.on('move', () => {
      clearTimeout(_playerMovedTimer);
      _playerMovedTimer = setTimeout(pushPlayerDisplay, 300);
    });
  });
}

// ─── Display detection ────────────────────────────────────────────────────────
// Track both windows so we can push display info to each.
let dmWin     = null;
let playerWin = null;
let _playerMovedTimer = null;

function getDisplayForWindow(win) {
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  const center = { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) };
  return screen.getDisplayNearestPoint(center);
}

// Push the Player window's display to both the Player and DM renderers.
// Both need to know the TV's resolution — DM uses it for map sizing (Task 2).
function pushPlayerDisplay() {
  if (!playerWin || playerWin.isDestroyed()) return;
  if (playerWin.isMinimized()) return;
  const display = getDisplayForWindow(playerWin);
  if (!display) return;
  if (!playerWin.isDestroyed()) playerWin.webContents.send('display-info', display);
  if (dmWin && !dmWin.isDestroyed()) dmWin.webContents.send('display-info', display);
}

// ─── Native fullscreen toggle — no user-gesture requirement, bypasses Chromium's
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

// Read a scene's video into an ArrayBuffer so the Player can play it from an
// in-memory blob instead of the same file:// path the DM is already streaming.
// Two <video> elements reading the same file concurrently starve Chromium's media
// pipeline for it (decode drops to 0, both windows stall at readyState 2); a private
// blob per window removes that contention.
ipcMain.handle('read-video-file', async (_event, sceneId) => {
  if (!isSafeId(sceneId)) return null;
  for (const ext of ['.webm', '.mp4']) {
    const filePath = path.join(mapsDir, sceneId + ext);
    try {
      const buf = await fs.promises.readFile(filePath);
      // Hand back an exact-length ArrayBuffer for structured-clone transfer.
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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

// --- Diagnostic log IPC ---

let logsDir;

const _diagModeFiles = { dm: 'video-diag-dm.log', player: 'video-diag-player.log' };

// One long-lived append stream per mode. Deliberately NOT appendFileSync: during a
// video stall both windows emit dozens of diag events/sec, and a synchronous
// open/write/close on the shared main process for each would back up the event loop
// and starve the video pipeline — amplifying the very stall we're trying to observe.
// A buffered WriteStream writes async and keeps the fd open, so logging stays cheap.
const _diagStreams = {};

function _diagStream(mode) {
  const filename = _diagModeFiles[mode];
  if (!filename || !logsDir) return null; // reject unknown modes; silently drop before app.whenReady
  if (!_diagStreams[mode]) {
    _diagStreams[mode] = fs.createWriteStream(path.join(logsDir, filename), { flags: 'a' });
    _diagStreams[mode].on('error', () => {});
  }
  return _diagStreams[mode];
}

// On each launch, retire the previous session's log to a dated archive and keep only
// the last 3 per mode (2 archives + the fresh current session). The logs write
// continuously whenever a video plays (watchdog heartbeat every ~3s) regardless of
// whether the on-screen overlay is open, so in append mode they'd grow without bound.
// The live session keeps the stable filename (video-diag-<mode>.log); history is dated.
function _rotateDiagLogs() {
  if (!logsDir) return;
  const pad = n => String(n).padStart(2, '0');
  for (const filename of Object.values(_diagModeFiles)) {
    const base = filename.replace(/\.log$/, ''); // e.g. 'video-diag-dm'
    const current = path.join(logsDir, filename);
    // Archive the previous session's log under a name dated to when it last wrote.
    try {
      const stat = fs.statSync(current);
      if (stat.size > 0) {
        const m = new Date(stat.mtimeMs);
        const stamp = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}` +
          `_${pad(m.getHours())}-${pad(m.getMinutes())}-${pad(m.getSeconds())}`;
        fs.renameSync(current, path.join(logsDir, `${base}-${stamp}.log`));
      }
    } catch {} // no current log yet — first run
    // Prune archives to the newest 2 (dated names sort chronologically).
    try {
      const archives = fs.readdirSync(logsDir)
        .filter(f => f.startsWith(base + '-') && f.endsWith('.log'))
        .sort();
      for (const f of archives.slice(0, Math.max(0, archives.length - 2))) {
        try { fs.unlinkSync(path.join(logsDir, f)); } catch {}
      }
    } catch {}
  }
}

ipcMain.on('diag-append-line', (_event, mode, line) => {
  const stream = _diagStream(mode);
  if (stream) stream.write(line + '\n');
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
  logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  _rotateDiagLogs();

  // Re-push display info when the user moves/resizes the Player window or the
  // OS display configuration changes (resolution, scale factor, plugged-in TV).
  const onDisplayChange = () => pushPlayerDisplay();
  screen.on('display-added',   onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  createDMWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createDMWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
