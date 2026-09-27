'use strict';
// macUpdate.js — the Mac's own update: fetch the pointer, download the zip, swap the app, relaunch.
//
// Squirrel refuses an unsigned app, so none of electron-updater's install path runs here. The
// pointer is the same latest-mac.yml electron-builder writes for it.

const { ipcMain, app } = require('electron');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// `latest/download` follows GitHub's newest release, so deleting one walks every Mac back to the
// previous. A build whose publish config is a generic url reads that instead, as electron-updater
// does; CI builds one to serve updates locally (update-proofs.yml).
function readFeed() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const url = /^url:\s*['"]?([^'"\s]+)/m.exec(yml);
    if (/^provider:\s*generic/m.test(yml) && url) return url[1].replace(/\/?$/, '/');
  } catch (_) {}
  return 'https://github.com/Hinnful/Evermist/releases/latest/download/';
}
const FEED = readFeed();

let setStatus;
let _ready = null;   // { app: the extracted Evermist.app, target: the one to replace }

function get(url, onData, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Evermist' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).href, onData, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(url + ' answered ' + res.statusCode)); return; }
      const total = Number(res.headers['content-length']) || 0;
      const chunks = [];
      res.on('data', c => { if (onData) onData(c, total); else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// The pointer's first `files:` entry ending in .zip, and the top-level version.
function readPointer(text) {
  const version = (/^version:\s*['"]?([^'"\s]+)/m.exec(text) || [])[1];
  const zip = /-\s*url:\s*['"]?([^'"\s]+\.zip)['"]?\s*\n\s*sha512:\s*['"]?([^'"\s]+)/.exec(text);
  return version && zip ? { version, url: zip[1], sha512: zip[2] } : null;
}

function run(file, args) {
  return new Promise((resolve, reject) =>
    execFile(file, args, err => err ? reject(err) : resolve()));
}

// ⚠ A COPY RUN FROM DOWNLOADS OR THE .dmg SITS IN A READ-ONLY PLACE, and a swap there fails
// after the download. It is offered the move instead.
function target() {
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  if (!bundle.endsWith('.app')) return null;
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); } catch (_) { return null; }
  return bundle;
}

async function check() {
  if (!app.isInApplicationsFolder()) { setStatus({ state: 'move' }); return; }
  const dest = target();
  if (!dest) { setStatus({ state: 'manual' }); return; }

  const pointer = readPointer(String(await get(new URL('latest-mac.yml', FEED).href)));
  if (!pointer) throw new Error('latest-mac.yml names no zip');
  // Differs, not newer: an older pointer is a pulled release, and following it is the rollback.
  if (pointer.version === app.getVersion()) { setStatus({ state: 'none' }); return; }

  const dir = path.join(app.getPath('cache'), 'evermist-update', pointer.version);
  const zipPath = path.join(dir, 'Evermist.zip');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  setStatus({ state: 'downloading', version: pointer.version });
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(zipPath);
  let got = 0, shown = -1;
  await get(new URL(pointer.url, FEED).href, (chunk, total) => {
    hash.update(chunk);
    out.write(chunk);
    got += chunk.length;
    const percent = total ? Math.floor(got * 100 / total) : null;
    if (percent !== null && percent !== shown) {
      shown = percent;
      setStatus({ state: 'downloading', percent });
    }
  });
  await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()));
  if (hash.digest('base64') !== pointer.sha512) throw new Error('the update failed its checksum');

  // ditto keeps the framework symlinks an unzip would flatten.
  const unpacked = path.join(dir, 'app');
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked]);
  const bundle = fs.readdirSync(unpacked).find(n => n.endsWith('.app'));
  if (!bundle) throw new Error('the update zip holds no app');
  fs.rmSync(zipPath, { force: true });

  _ready = { app: path.join(unpacked, bundle), target: dest };
  setStatus({ state: 'ready', version: pointer.version });
}

// ⚠ THE SWAP RUNS AFTER THIS PROCESS EXITS, so it cannot be done in here. A detached shell waits
// on the pid, moves the old copy aside and restores it if the new one fails to land.
const SWAP = `
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
rm -rf "$3.old"
if mv "$3" "$3.old"; then
  if mv "$2" "$3"; then rm -rf "$3.old"; else mv "$3.old" "$3"; fi
fi
xattr -dr com.apple.quarantine "$3" 2>/dev/null
open "$3"
`;

function install() {
  if (!_ready) return;
  spawn('/bin/bash', ['-c', SWAP, 'swap', String(process.pid), _ready.app, _ready.target],
    { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

function moveToApplications() {
  try {
    // Replacing an older copy already in Applications is what the DM asked for by clicking.
    if (app.moveToApplicationsFolder({ conflictHandler: () => true })) return;
  } catch (_) {}
  setStatus({ state: 'manual' });
}

function initMacUpdate(setUpdateStatus) {
  setStatus = setUpdateStatus;
  ipcMain.on('install-update', install);
  ipcMain.on('move-to-applications', moveToApplications);
  check().catch(err => setStatus({ state: 'error', message: String((err && err.message) || err) }));
}

module.exports = { initMacUpdate };
