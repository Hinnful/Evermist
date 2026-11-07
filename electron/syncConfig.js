'use strict';
// syncConfig.js — which Google client sync signs in with. The release build carries one in `googleClient.json` beside
// this file, written from CI secrets by tools/write-google-client.js and never committed; a dev run without that file
// reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET instead. `userData/sync/config.json` overrides both: the rig's fake
// Drive and its test client. With no client at all the app shows no sync and keeps no sync index. Tested.

const fs = require('fs');
const path = require('path');

const FILE = 'config.json';
const BUILT_IN = path.join(__dirname, 'googleClient.json');

const _url = v => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch (_) { return null; } };
const _str = v => (typeof v === 'string' ? v.trim() : '');

function _client(id, secret) {
  const clientId = _str(id), clientSecret = _str(secret);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// The config in a file's text, or null when it is not usable. Only the fields below are read.
function parseSyncConfig(text) {
  let d;
  try { d = JSON.parse(text); } catch (_) { return null; }
  if (!d || typeof d !== 'object') return null;
  const out = _client(d.clientId, d.clientSecret);
  if (!out) return null;
  for (const k of ['apiBase', 'tokenUrl']) {
    if (d[k] === undefined) continue;
    const u = _url(d[k]);
    if (!u) return null;
    out[k] = d[k];
  }
  return out;
}

// The client built into the app (`fileText`, the built-in file's text or null), else the environment's, else null.
// The built-in file names Google only: a fake Drive's address is the override's alone.
function builtInClient(fileText, env) {
  let d = null;
  try { d = fileText == null ? null : JSON.parse(fileText); } catch (_) { d = null; }
  return (d && typeof d === 'object' && _client(d.clientId, d.clientSecret)) || _client((env || {}).GOOGLE_CLIENT_ID, (env || {}).GOOGLE_CLIENT_SECRET);
}

const _read = file => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } };

function readSyncConfig(userData, opts) {
  const o = opts || {};
  const override = _read(path.join(userData, 'sync', FILE));
  return (override !== null && parseSyncConfig(override)) || builtInClient(_read(o.builtIn || BUILT_IN), o.env || process.env);
}

function register(ctx) {
  const { ipcMain } = require('electron');
  // The page learns only whether sync exists here, never the secret.
  ipcMain.handle('sync-available', () => !!readSyncConfig(ctx.userData));
}

module.exports = { register, parseSyncConfig, builtInClient, readSyncConfig };
