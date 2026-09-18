'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

// Diagnostic modes, each behind its own npm script's flag. All inert under plain `npm start` and
// in the shipped .exe, which never passes one.
const stressMode = process.argv.includes('--stress');
const stressNoReveals = process.argv.includes('--stress-no-reveals');
const memProbeMode    = process.argv.includes('--memprobe');
// Stub levers that attribute the minimize memory movement — each disables one suspect.
const memProbeNoFlush = process.argv.includes('--memprobe-no-flush');
const memProbeNoSave  = process.argv.includes('--memprobe-no-save');
const memProbeSmall   = process.argv.includes('--memprobe-small');
const stressIntervalArg = process.argv.find(a => a.startsWith('--stress-interval='));
const stressMs = stressIntervalArg
  ? (v => (isNaN(v) || v <= 0 ? 900000 : v))(parseInt(stressIntervalArg.split('=')[1], 10))
  : 900000;
if (stressMode) {
  const id = powerSaveBlocker.start('prevent-display-sleep');
  console.log('[stress] powerSaveBlocker started id=' + id + ' interval=' + stressMs + 'ms');
}

// ⚠ Never redirect userData beside the .exe again: it orphans a library on upgrade.

// ⚠ Keeps Chromium from removing the video track on a muted looping video its compositor deems
// occluded. Without it readyState drops after ~30 s and the video freezes cyclically.
app.commandLine.appendSwitch('disable-features', 'BackgroundVideoTrackOptimization');

// Every push to a renderer goes through this. A window can close mid-save, and `send` on a gone
// webContents throws - inside a stream handler that throw takes the main process with it.
function sendTo(target, channel, payload) {
  const wc = target && target.webContents ? target.webContents : target;
  if (!wc || wc.isDestroyed()) return;
  try { wc.send(channel, payload); } catch (_) {}
}

// Window/taskbar icon for `npm start`. A packaged build uses the icon embedded in the .exe, so a
// missing file here is harmless — fall back to undefined.
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
  const q = {};
  if (stressMode) {
    q.stress = '1';
    if (stressMs !== 900000) q.stressMs = String(stressMs);
    if (stressNoReveals) q.noReveals = '1';
  }
  if (memProbeMode) {
    q.memprobe = '1';
    if (memProbeNoFlush) q.memprobeNoFlush = '1';
    if (memProbeNoSave)  q.memprobeNoSave  = '1';
    if (memProbeSmall)   q.memprobeSmall   = '1';
  }
  if (Object.keys(q).length) win.loadFile('index.html', { query: q });
  else win.loadFile('index.html');
  dmWin = win;
  win.once('closed', () => { if (dmWin === win) dmWin = null; });
  // visibilitychange does not fire on Windows OS-minimize, so signal the renderer
  // here instead — lets it pause the PixiJS ticker / flush the texture pool while hidden.
  win.on('minimize', () => sendTo(win, 'window-visibility', { visible: false }));
  win.on('restore',  () => sendTo(win, 'window-visibility', { visible: true  }));
  // Hand off from splash to app once the renderer has painted. A minimum keeps it from flashing,
  // and a cap keeps a slow init from leaving the splash up.
  const MIN_SPLASH_MS = 1000;
  let handedOff = false;
  const handOff = () => {
    if (handedOff) return;
    handedOff = true;
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - splashShownAt));
    setTimeout(() => {
      if (!splash.isDestroyed()) splash.destroy();
      if (win.isDestroyed()) return;   // closed during the wait, or during the 6s cap below
      win.show();
      // The splash is alwaysOnTop and owns the OS focus until it is destroyed, so show() alone
      // leaves the app visible but not focused. Claim focus once nothing competes for it.
      win.focus();

    }, wait);
  };
  win.once('ready-to-show', handOff);
  setTimeout(handOff, 6000); // safety cap

  // Allow window.open() in the renderer to create the player BrowserWindow.
  // ⚠ EVERY Player window is created HIDDEN until the DM presses the button: one is pre-warmed at
  // startup, and showing that would put an empty window on the TV all session.
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1200,
      height: 800,
      show: false,
      title: 'Evermist — Player View',
      // --fog-base in base.css: Chromium paints it between two documents, and this window navigates.
      backgroundColor: '#1a1a2e',
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
  win.webContents.on('did-create-window', (childWin, details) => {
    childWin.setMenu(null);
    // ⚠ ONE HANDLE PER WINDOW NAME. The DM can have a Player window and a warm one at once, and
    // a single handle overwritten on each creation left the first never shown and never told the
    // TV's resolution. The name is the renderer's own (playerWindowName in viewport.js).
    const key = (details && details.frameName) || 'evermist-player';
    playerWins.set(key, childWin);
    // ⚠ `show: false` alone does not hold a window.open() child back — Electron shows it anyway.
    childWin.hide();
    childWin.once('closed', () => {
      if (playerWins.get(key) === childWin) playerWins.delete(key);
      clearTimeout(_playerMovedTimer);
    });
    childWin.on('minimize', () => sendTo(childWin, 'window-visibility', { visible: false }));
    childWin.on('restore',  () => sendTo(childWin, 'window-visibility', { visible: true  }));
    // NATIVE window fullscreen, so the renderer sees no fullscreenchange and the state lives only
    // here. Report it, or the DM's fullscreen button cannot show whether it is on.
    // ⚠ TAKE THE STATE FROM THE EVENT, NEVER FROM isFullScreen() INSIDE THE HANDLER: on Windows
    // the flag still holds the OLD value while the event runs, so every change reports backwards.
    const sendFullScreenState = (fullScreen) => sendTo(childWin, 'fullscreen-state', { fullScreen });
    childWin.on('enter-full-screen', () => sendFullScreenState(true));
    childWin.on('leave-full-screen', () => sendFullScreenState(false));
    // Push once the renderer is ready to receive IPC messages. Reading the flag IS correct
    // here: no transition is in flight, so it holds the settled value.
    // ⚠ EVERY LOAD, NOT THE FIRST. Two-map mode navigates this same window between the single
    // Player and the shell, and each new document needs the TV's size and the fullscreen state.
    childWin.webContents.on('did-finish-load', () => {
      pushPlayerDisplay(key);
      sendFullScreenState(childWin.isFullScreen());
    });
    // Re-push when the Player window is moved (debounced — fires after drag settles).
    childWin.on('move', () => {
      clearTimeout(_playerMovedTimer);
      _playerMovedTimer = setTimeout(() => pushPlayerDisplay(key), 300);
    });
  });
}

// ─── Display detection ────────────────────────────────────────────────────────
let dmWin     = null;
const playerWins = new Map();   // window name -> BrowserWindow; one per column in two-column mode
let _playerMovedTimer = null;

function showPlayerWindow(key) {
  const win = playerWins.get(key || 'evermist-player');
  if (win && !win.isDestroyed() && !win.isVisible()) win.show();
}

function getDisplayForWindow(win) {
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  const center = { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) };
  return screen.getDisplayNearestPoint(center);
}

// Both renderers need the TV's resolution: the DM sizes maps against it.
// ⚠ The push carries the window's NAME: with two columns the DM process receives both.
function pushPlayerDisplay(key) {
  const name = key || 'evermist-player';
  const playerWin = playerWins.get(name);
  if (!playerWin || playerWin.isDestroyed()) return;
  if (playerWin.isMinimized()) return;
  const display = getDisplayForWindow(playerWin);
  if (!display) return;
  const payload = { ...display, playerName: name };
  sendTo(playerWin, 'display-info', payload);
  sendTo(dmWin, 'display-info', payload);
}

// Native fullscreen, so it has no user-gesture requirement and sidesteps Chromium's activation
// check, which blocks a renderer's own requestFullscreen() on a window that is not focused.
ipcMain.on('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

ipcMain.on('player-reveal', (_event, key) => showPlayerWindow(key));

let mapsDir;

function isSafeId(id) { return typeof id === 'string' && /^[0-9a-zA-Z_-]+$/.test(id); }

// Each subject's IPC lives in electron/. Requiring one registers its handlers; register() hands
// it the paths and helpers it needs, once the app is ready and they exist.
const IPC = [
  require('./electron/videoFiles.js'),
  require('./electron/music.js'),
  require('./electron/floorPlan.js'),
  require('./electron/diagLog.js'),
  require('./electron/updates.js'),
  require('./electron/pdfText.js'),
  require('./electron/backupZip.js'),
];
const [, ipcMusic, , ipcDiagLog, ipcUpdates] = IPC;   // the three with a call of their own

// The About box's version line. Reads package.json via Electron, so a version bump can
// never leave a stale number hardcoded in the renderer.
ipcMain.handle('app-version', () => app.getVersion());

// --- Memory probe: per-process working set (src/dev/memProbe.js, ?memprobe=1) ---
//
// getAppMetrics() is the only reading that covers what costs memory here: performance.memory
// reports the JS heap alone, and canvas backing stores, GPU textures and the video decoder are all
// native memory outside it. workingSetSize is also what Task Manager shows.
ipcMain.handle('mem-metrics', () => {
  try {
    return app.getAppMetrics().map(m => ({
      pid:  m.pid,
      type: m.type,
      name: m.name || '',
      // Kilobytes, as Electron reports them. The renderer converts.
      workingSetKB: m.memory ? m.memory.workingSetSize : 0,
      peakWorkingSetKB: m.memory ? (m.memory.peakWorkingSetSize || 0) : 0,
      cpuPercent: m.cpu ? m.cpu.percentCPUUsage : 0,
    }));
  } catch (_) { return []; }
});

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  mapsDir = path.join(userData, 'maps');
  const musicDir = path.join(userData, 'music');
  const logsDir  = path.join(userData, 'logs');
  for (const dir of [mapsDir, musicDir, logsDir]) fs.mkdirSync(dir, { recursive: true });

  // ⚠ AFTER THE FOLDERS EXIST AND BEFORE ANY WINDOW OPENS. A handler registered on require
  // reads its path from here, so one that fires before this line has nowhere to write.
  const ctx = { mapsDir, musicDir, logsDir, sendTo, isSafeId, getDmWin: () => dmWin };
  for (const mod of IPC) mod.register(ctx);

  ipcDiagLog._rotateDiagLogs();
  ipcMusic.ensureYtdlp();

  // Re-push display info when the user moves/resizes the Player window or the
  // OS display configuration changes (resolution, scale factor, plugged-in TV).
  const onDisplayChange = () => pushPlayerDisplay();
  screen.on('display-added',   onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  createDMWindow();
  ipcUpdates.initAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createDMWindow();
  });
}).catch(err => {
  // Nothing has a window yet, so a failure here is otherwise a process that exits in silence.
  dialog.showErrorBox('Evermist could not start',
    'The app could not prepare its data folder: ' + ((err && err.message) || err));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
