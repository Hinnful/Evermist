'use strict';
// statBlockFetch.js — a monster page for the stat block import, read once the page's own scripts
// have drawn it. The renderer cannot fetch it: file:// is refused by every site's CORS.

const { ipcMain, BrowserWindow } = require('electron');

// Seen in the page text once the stat block is drawn; a static page matches on the first look.
// A word boundary cannot mark a Cyrillic word's edge, so a letter class does.
const DRAWN = /armor class|класс (доспеха|защиты|брони)|(^|[^\p{L}])(AC|КД):?\s*\d/iu;
const LIMIT_MS = 20000;
// One poll's pause was too short: a slow machine sees a site stop between two stages of drawing.
const STILL_MS = 1500;

function register() {}

function readPage(url) {
  // ⚠ NEVER SHOWN: nothing may put a window on the DM's screen. Its own in-memory session keeps
  // the site's cookies out of the app's.
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, images: false,
      backgroundThrottling: false, partition: 'statblock' },
  });
  // A site's ad scripts open WebRTC sockets, and a listening socket raises the Windows firewall prompt.
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, answer) => answer(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const started = Date.now();
  return new Promise((resolve) => {
    let done = false, busy = false, lastLength = -1, changedAt = Date.now();
    const finish = (r) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      if (!win.isDestroyed()) win.destroy();
      resolve(r);
    };
    const run = (js) => win.webContents.executeJavaScript(js);
    const poll = setInterval(async () => {
      if (busy || done) return;
      busy = true;
      try {
        const text = await run('document.body ? document.body.innerText : ""');
        const late = Date.now() - started > LIMIT_MS;
        // ⚠ A SITE CAN DRAW ITS HEADER FIRST: ttg.club serves every action name with no text or dice
        // and fills them in after, so the page is taken only once its text has also held still.
        // A page with no stat block still comes back once the time is up, so the import can say so.
        if (text.length !== lastLength) { lastLength = text.length; changedAt = Date.now(); }
        const still = Date.now() - changedAt >= STILL_MS;
        if ((DRAWN.test(text) && still) || late) finish({ ok: true, text: await run('document.documentElement.outerHTML') });
      } catch (err) {
        if (Date.now() - started > LIMIT_MS) finish({ ok: false, error: 'The page did not load in 20 seconds.' });
      }
      busy = false;
    }, 500);
    // -3 is a load the page itself cut short by redirecting.
    win.webContents.on('did-fail-load', (_e, code, desc, _url, isMain) => {
      if (isMain && code !== -3) finish({ ok: false, error: `The page could not be opened (${desc}).` });
    });
    win.loadURL(url).catch(() => {});
  });
}

// Any web page; never a file: or other scheme.
ipcMain.handle('fetch-stat-page', async (_event, link) => {
  try {
    const u = new URL(link);
    if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'That is not a web link.' };
    return await readPage(u.href);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

module.exports = { register };
