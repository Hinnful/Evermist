'use strict';
// mcpBridge.js — the Claude connection's door into the running app. A server on 127.0.0.1 takes each
// tool call from electron/mcpShim.js, asks the DM window (src/mcp/mcpTools.js) and hands back its answer.
// Its port and a per-launch key sit in userData/mcp.json, which only this user can read. It also builds
// the Claude desktop extension Settings' Connect to Claude opens.

const { app, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { mcpManifest } = require('./mcpConfig.js');
const { TOOLS } = require('./mcpShim.js');

const REPLY_MS = 20000;
const MAX_BODY = 1024 * 1024;
const pending = new Map();
let getDmWin = () => null;
let sendTo = () => {};
let ready = false;
let lastCall = Date.now();
let nextId = 1;

// The DM window says so once its handler is listening; a call before that is told to wait.
ipcMain.on('mcp-ready', (event) => {
  const win = getDmWin();
  if (win && event.sender === win.webContents) ready = true;
});

ipcMain.on('mcp-reply', (event, id, result) => {
  const win = getDmWin();
  if (!win || event.sender !== win.webContents) return;
  const p = pending.get(id);
  if (p) { pending.delete(id); p(result); }
});

function askDmWindow(tool, args) {
  const win = getDmWin();
  if (!ready || !win || win.isDestroyed()) return Promise.resolve({ starting: true, text: 'Evermist is still starting. Try again in a moment.', isError: true });
  const id = nextId++;
  return new Promise(resolve => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ text: 'Evermist did not answer in time.', isError: true }); }, REPLY_MS);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r || { text: 'Evermist gave no answer.', isError: true }); });
    sendTo(win, 'mcp-request', { id, tool, args });
  });
}

function sameKey(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ⚠ A WEB PAGE CAN POST TO 127.0.0.1 TOO. The key refuses it, and so does any Origin header: the shim sends none.
function serve(token) {
  return http.createServer((req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || req.url !== '/call' || req.headers.origin || !sameKey(req.headers['x-evermist-token'], token)) {
      reply(403, { text: 'Refused.', isError: true });
      req.resume();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', async () => {
      let call;
      try { call = JSON.parse(body); } catch { reply(400, { text: 'Unreadable request.', isError: true }); return; }
      lastCall = Date.now();
      reply(200, await askDmWindow(String(call.tool || ''), call.args && typeof call.args === 'object' ? call.args : {}));
    });
  });
}

// How Claude starts this same app unseen: the installed executable, or Electron on this folder under `npm start`.
// ⚠ AN APPIMAGE RUNS FROM A MOUNT THAT IS GONE ONCE IT QUITS, so the .AppImage file itself is what starts it.
function launchCommand() {
  if (process.env.APPIMAGE) return [process.env.APPIMAGE];
  return app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
}

// The extension is a zip Claude installs: the manifest, and the shim as its server.
function buildExtension(addressFile) {
  const out = path.join(app.getPath('userData'), 'mcp', 'Evermist.mcpb');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const manifest = mcpManifest({ version: app.getVersion(), tools: TOOLS, addressFile, launch: launchCommand() });
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(out);
    const zip = archiver('zip', { zlib: { level: 6 } });
    stream.on('close', () => resolve(out));
    zip.on('error', reject);
    zip.pipe(stream);
    zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    zip.append(fs.readFileSync(path.join(__dirname, 'mcpShim.js')), { name: 'server/index.js' });
    zip.finalize();
  });
}

function register(ctx) {
  getDmWin = ctx.getDmWin;
  sendTo = ctx.sendTo;
  const addressFile = path.join(app.getPath('userData'), 'mcp.json');
  const token = crypto.randomBytes(24).toString('hex');
  const server = serve(token);
  server.on('error', err => console.error('[mcp] the Claude connection could not open:', err));
  server.listen(0, '127.0.0.1', () => {
    try { fs.writeFileSync(addressFile, JSON.stringify({ port: server.address().port, token }), { mode: 0o600 }); }
    catch (err) { console.error('[mcp] the Claude connection could not be written down:', err); }
  });
  app.on('will-quit', () => {
    server.close();
    try { fs.unlinkSync(addressFile); } catch (_) {}
  });
  // Answers '' once the OS has handed the file to Claude, else the reason it could not.
  ipcMain.handle('mcp-connect-claude', async () => {
    try { return await shell.openPath(await buildExtension(addressFile)); }
    catch (err) { return (err && err.message) || String(err); }
  });
}

module.exports = { register, notReady: () => { ready = false; }, lastCallAt: () => lastCall };
