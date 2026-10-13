'use strict';
// displays.js — the screens: the list the DM's window picks the TV from, moving the Player onto one
// in fullscreen, and switching a mirrored TV to a second screen. src/player/tvPick.js decides which
// screen is the TV; this only gathers the list and acts.

const { ipcMain, screen, shell } = require('electron');
const { execFile } = require('child_process');

let ctx = null;
function register(c) { ctx = c; }

function describe(d) {
  return {
    id: d.id, label: d.label || '', internal: !!d.internal,
    bounds: d.bounds, size: d.size, scaleFactor: d.scaleFactor,
  };
}

function displayHolding(win) {
  if (!win || win.isDestroyed()) return null;
  const b = win.getBounds();
  return screen.getDisplayNearestPoint({ x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) });
}

ipcMain.handle('displays-list', () => {
  const dm = ctx && displayHolding(ctx.getDmWin());
  return { displays: screen.getAllDisplays().map(describe), dmDisplayId: dm ? dm.id : null };
});

// ⚠ A fullscreen window does not move: leave it first, then place it. The wait is bounded because
// a window that never reports leaving would otherwise hold the call for good.
function leaveFullScreen(win) {
  if (!win.isFullScreen()) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { win.removeListener('leave-full-screen', done); resolve(); }, 1500);
    win.once('leave-full-screen', done);
    win.setFullScreen(false);
  });
}

// Under the rig's --offscreen a window never moves or fullscreens: it must stay where the parker put it.
ipcMain.handle('player-place', async (_event, name, displayId) => {
  if (!ctx) return { ok: false };
  if (ctx.offscreen) return { skipped: true };
  const win = ctx.getPlayerWin(typeof name === 'string' ? name : undefined);
  const target = screen.getAllDisplays().find(d => d.id === displayId);
  if (!win || win.isDestroyed() || !target) return { ok: false };
  await leaveFullScreen(win);
  if (win.isDestroyed()) return { ok: false };
  win.setBounds(target.bounds);
  win.setFullScreen(true);
  return { ok: true };
});

function runDisplaySwitch(arg) {
  return new Promise(resolve => {
    execFile('DisplaySwitch.exe', [arg], { windowsHide: true }, err => resolve(!err));
  });
}

// Mirror to extend. Windows has a switch for it; a Mac has only the settings pane.
ipcMain.handle('display-extend', async () => {
  if (ctx && ctx.offscreen) { console.log('[displays] extend skipped under --offscreen'); return { skipped: true }; }
  if (process.platform === 'win32') {
    const ok = (await runDisplaySwitch('/extend')) || (await runDisplaySwitch('3'));
    return { ok };
  }
  if (process.platform === 'darwin') {
    try { await shell.openExternal('x-apple.systempreferences:com.apple.Displays-Settings.extension'); return { ok: true }; }
    catch (_) { return { ok: false }; }
  }
  return { ok: false, unsupported: true };
});

module.exports = { register };
